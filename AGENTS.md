# AGENTS.md

Guidance for AI coding agents working in this repo. Read before making changes.

## What this is

KiboTalk — "Live Reply Coach" MVP: a live foreign-language conversation coach.
Speaker verification splits user vs counterpart; only when the counterpart
finishes a turn do we generate reply suggestions. The user's own utterances
also enter the same conversation stream and shape the next suggestion.

Authoritative spec: `docs/spec/live-reply-coach-mvp.md`. ADRs in
`docs/adr/`. Past fixes & known pitfalls in `docs/solutions/` (read the
relevant one before touching a documented area). When implementation and spec
diverge, align per spec or update the spec — don't silently drift.

## Architecture

Client orchestration + thin proxy (ADR 0001). The browser runs the pipeline;
`apps/api` is a stateless Hono proxy that hides provider keys and forwards STT/LLM.

```
apps/
  api/        Hono proxy: /stt, /llm (SSE). Keys live server-side only.
  playground/ Vite + React dev panel (Chinese UI) for testing each layer.
  web/        PWA shell (not yet built).
packages/
  audio/      VAD state machine + encodeWav. Silero via transformers.js.
  llm/        LLM client (xsai).
  prompts/    Reply-suggestion prompts (Velin TSX → markdown).
  speaker/    Speaker verification (wavlm-base-plus-sv, WASM + IndexedDB).
  stt/        Provider-agnostic STT client factory + adapters.
  pipeline/   Conversation store + turn state machine.
  ui/         shadcn/ui primitives on Tailwind v4 (shared).
  app-shared/ Shared client types/config shell.
```

## Tech stack — do not bypass these

These are spec-named choices. **Do not rewrite or substitute them** with hand-rolled equivalents:

- **LLM → `xsai`** (`@xsai/stream-text`). Never hand-roll fetch/SSE for LLM. An official `xsai` skill is installed at `.agents/skills/xsai/` — read its `SKILL.md` + `references/` before touching `packages/llm`.
- **Prompts → Velin** (`@velin-dev/core-react`). Render TSX components to markdown strings; don't template with raw string concat.
- **STT → provider-agnostic factory** in `packages/stt`, reached via the `apps/api` `/stt` proxy. Local ASR (`mlx-qwen3-asr`) also goes through the proxy (`?provider=openai`), **never browser-direct** (ADR 0002).
- **VAD → Silero** via `@huggingface/transformers`. v6.2 needs a 64-sample context prepended to each 512-sample chunk (576 input), carried across calls; v5 takes 512 raw. See `apps/playground/src/audio/silero-vad.ts`.
- **Speaker → `Xenova/wavlm-base-plus-sv`** via transformers.js in a Web Worker; embeddings persist in IndexedDB.

## Audio pipeline specifics

- **Sample rate**: 16 kHz mono PCM everywhere (VAD, STT uploads, speaker embeddings).
- **VAD chunk size**: 512 samples (32 ms) per `processAudio` call (`packages/audio/src/vad.ts` `newBufferSize`). Silero v6.2 prepends 64-sample context → 576 input; v5 takes 512 raw. See `docs/solutions/silero-vad-v6-context-frame.md`.
- **STT upload format**: WAV 16 kHz mono PCM via `encodeWav` (`packages/audio/src`). The `/stt` proxy forwards the WAV body as-is.
- **Speaker embeddings**: computed in a Web Worker (`apps/playground/src/audio/speaker-worker.ts`), persisted in IndexedDB. Don't run the WASM model on the main thread.
- **Segment aggregation** (`packages/audio/src/aggregator.ts`): sits between VAD (+ speaker verification) and `pipeline.ingestSegment`. Accumulates same-speaker VAD segments and flushes one merged turn when silence exceeds the speaker's pause threshold (`otherPauseMs`/`userPauseMs`), when accumulated audio exceeds `maxMs`, or on speaker change. Silence gaps between constituents are reconstructed from segment timing. This is where `vadOtherPauseMs`/`vadUserPauseMs` (spec §2.4) actually take effect — the pipeline itself fires LLM immediately per ingested turn and does NOT wait. The pipeline contract (one ingested segment = one turn) stays unchanged.

## Conventions

- **Keys in env, never client.** All provider keys/config live in `.env` (see `.env.example`), loaded by `apps/api`. Naming: `<SCOPE>_<PROVIDER>_<FIELD>` (e.g. `LLM_OPENROUTER_API_KEY`, `STT_OPENAI_BASE_URL`).
- **Pure functions; no new classes** unless the framework/API requires it. Imports at top. TS unions: exhaustive `switch`.
- **Full words.** No obscure abbreviations; only use ones common in software.
- **Smallest correct diff.** Only change what was asked. No drive-by refactor, tests, or docs unless asked. When you touch code, small progressive refactors alongside the change are welcome.
- **Reuse and extend** existing functions/modules; do not duplicate similar logic. Before implementing a feature (a selector, a hook, a helper, a card), grep the repo for it first — chances are someone already wrote it. The moment you notice a second copy of something, extract it into a shared module/component and have both callers use it. Examples already in the repo: `SttProviderSelect` + `useSttProviders` + `sttUrl` (`apps/playground/src/SttProviderSelect.tsx`, used by both the VAD panel and the direct-API panel), `padBuffer` / `encodeWav` (`packages/audio`), `createSegmentAggregator` (`packages/audio/aggregator`).
- **No backward-compatibility guards.** If a rename/breakage is needed, do it directly and update callers in the same change.
- **Playground UI is Chinese** — labels, examples, and sample content in Chinese.
- **Tailwind v4 + shadcn/ui** for all UI (playground included). Shared primitives in `packages/ui`. When you add/update a `packages/ui` component, keep this README's component list in sync.
- **Shared playground config lives in one Zustand store** (`apps/playground/src/config-store.ts`, `useConfig`) — the React analog of a Pinia store. VAD/ASR/merge/speaker knobs and selectors (provider, VAD model, transcribe mode) are shared across the VAD panel and the live session: change one on a tab and it's already aligned on the other. Subscribe per-field (`useConfig(s => s.field)`); in async callbacks read `useConfig.getState()`. Stage-grouped field components live in `apps/playground/src/components/ConfigFields.tsx` (`VadParamsFields`, `AsrPadFields`, `MergeParamsFields`, `VadModelSelect`, `TranscribeModeSelect`, `TranscribeProviderSelect`, `NumberField`) — reuse these instead of re-declaring the same knobs.

## Commands

```bash
pnpm install
pnpm dev:api          # Hono proxy (loads .env from repo root)
pnpm dev:playground   # Vite dev panel
pnpm dev:web          # PWA shell
pnpm build            # turbo build (all)
pnpm test             # turbo test (vitest per package)
pnpm typecheck        # turbo typecheck
```

Per-package: `pnpm --filter @kibotalk/<pkg> <script>` (e.g. `pnpm --filter @kibotalk/playground exec tsc --noEmit`).

## Testing & debugging practices

- Vitest per package; keep runs targeted for speed (`pnpm exec vitest run <path>`).
- For a reported bug, **reproduce with a test-only repro first** before changing production code. If a unit test can't reproduce it, use the smallest higher-level automated test that can.
- Prefer runtime evidence (logs, reproduction) over code-only reasoning when debugging. Don't "fix" with 100% confidence from reading code alone — confirm with a run.
- When debugging, instrument with logs, reproduce, analyze, then fix; remove instrumentation only after a post-fix run proves success.
- Known pitfalls and past fixes live in `docs/solutions/` (one file per issue, YAML frontmatter: `module`/`tags`/`problem_type`). Read the relevant solution before touching a documented area; add a new solution when you solve a non-obvious bug.

## Before finishing a change

- Run `code-simplifier` / `deslop` on the changes when readability or logic changed.
- Run targeted tests or `pnpm typecheck` when logic changed.
- Don't commit unless asked. When asked, use conventional commits (`feat(scope):`, `fix(scope):`, etc.), English subject; split unrelated changes into separate commits.
- Leave no debug instrumentation (console logs, fetch-to-localhost probes) in committed code.
