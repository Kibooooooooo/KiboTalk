# vieval for TypeScript monorepo prompt evaluation

Status: research notes (primary sources only). Date: 2026-07-23.

Package researched: [`vieval@0.0.12`](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/package.json) in [vieval-dev/vieval](https://github.com/vieval-dev/vieval).

## Sources

| Kind | URL |
| --- | --- |
| README | https://github.com/vieval-dev/vieval/blob/main/README.md |
| Getting started | https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/getting-started.md |
| Core concepts | https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/core-concepts.md |
| Tasks / cases | https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/learn/tasks-cases-and-inputs.md |
| Scores / metrics | https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/learn/assertions-scores-and-metrics.md |
| Models | https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/learn/models-and-inference-executors.md |
| Matrices | https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/learn/matrices-and-datasets.md |
| Reports | https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/learn/reports-and-comparisons.md |
| Config map | https://github.com/vieval-dev/vieval/blob/main/docs/content/en/config/index.md |
| API map | https://github.com/vieval-dev/vieval/blob/main/docs/content/en/api/index.md |
| Chat models plugin | https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/plugins/chat-models/index.ts |
| Runtime config | https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/plugins/chat-models/runtime-config.ts |
| Telemetry helpers | https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/plugins/chat-models/telemetry.ts |
| DSL (`score`/`metric`) | https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/dsl/task.ts |
| Report artifacts | https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/cli/report-artifacts.ts |
| OpenAI adapter | https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/core/inference-executors/remote-providers/openai/index.ts |

Official example projects (under `packages/vieval/tests/projects/`):

- [example-api-config-matrix](https://github.com/vieval-dev/vieval/tree/main/packages/vieval/tests/projects/example-api-config-matrix)
- [example-api-defining-new-task](https://github.com/vieval-dev/vieval/tree/main/packages/vieval/tests/projects/example-api-defining-new-task)
- [example-api-load-datasource-as-cases](https://github.com/vieval-dev/vieval/tree/main/packages/vieval/tests/projects/example-api-load-datasource-as-cases)
- [example-api-expect](https://github.com/vieval-dev/vieval/tree/main/packages/vieval/tests/projects/example-api-expect)
- [example-api-reporters-and-experiments](https://github.com/vieval-dev/vieval/tree/main/packages/vieval/tests/projects/example-api-reporters-and-experiments)
- [example-pattern-byoa-bring-your-own-agent](https://github.com/vieval-dev/vieval/tree/main/packages/vieval/tests/projects/example-pattern-byoa-bring-your-own-agent)

---

## 1. Minimal project layout

Two files are enough for a first run ([getting-started](https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/getting-started.md), [README Quick Start](https://github.com/vieval-dev/vieval/blob/main/README.md)):

```text
.
├── vieval.config.ts          # discovery + models + matrices
└── evals/
    └── smoke.eval.ts         # describeTask / caseOf
```

Install:

```bash
pnpm add -D vieval
```

Config discovers eval files under `projects[].root` via `include` (config directory is the base for relative roots — [config map](https://github.com/vieval-dev/vieval/blob/main/docs/content/en/config/index.md)). `.env*` is **not** auto-loaded; call `loadEnv` in the config.

Minimal chat-ready config (adapted from README):

```ts
// vieval.config.ts
import { cwd } from 'node:process'
import { defineConfig, loadEnv, requiredEnvFrom } from 'vieval'
import { chatModelFrom, ChatModels } from 'vieval/plugins/chat-models'

export default defineConfig({
  env: loadEnv('test', cwd(), ''),
  plugins: [
    ChatModels({
      models: [
        chatModelFrom({
          aliases: ['agent-mini', 'judge-mini'],
          apiKey: config => requiredEnvFrom(config.env, {
            name: 'OPENAI_API_KEY',
            type: 'string',
          }),
          inferenceExecutor: 'openai',
          model: 'gpt-4.1-mini',
        }),
      ],
    }),
  ],
  projects: [
    {
      include: ['evals/*.eval.ts'],
      name: 'default',
      root: '.',
      runMatrix: {
        extend: {
          model: ['agent-mini'],
          scenario: ['baseline'],
        },
      },
      evalMatrix: {
        extend: {
          rubric: ['default'],
        },
      },
    },
  ],
})
```

Minimal eval:

```ts
// evals/smoke.eval.ts
import { caseOf, describeTask, expect } from 'vieval'

describeTask('smoke', () => {
  caseOf('arithmetic-default', (context) => {
    expect(context.task.matrix.run.scenario).toBe('baseline')
    expect(2 + 2).toBe(4)
  }, {
    input: { prompt: 'Check simple arithmetic.' },
  })
})
```

Run:

```bash
pnpm exec vieval run --config ./vieval.config.ts
# with artifacts:
pnpm exec vieval run --config ./vieval.config.ts --report-out .vieval/reports --workspace local --experiment baseline --attempt attempt-a
```

`describeEval` is an alias of `describeTask`; prefer `describeTask` ([README](https://github.com/vieval-dev/vieval/blob/main/README.md)).

---

## 2. Register OpenAI-compatible chat models (DeepSeek)

### Mental model

Registration ≠ request. `ChatModels` / `chatModelFrom` only append `ModelDefinition`s. Task code must resolve a model and call a provider ([models guide](https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/learn/models-and-inference-executors.md)).

Built-in executor strings: `'openai' | 'openrouter' | 'ollama'` ([chat-models plugin](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/plugins/chat-models/index.ts)). OpenAI-compatible hosts (DeepSeek, LM Studio, etc.) use `inferenceExecutor: 'openai'` plus optional `baseURL`.

`chatModelFrom` for OpenAI accepts:

- `aliases`, `model`, `id?` (default `` `${inferenceExecutorId}:${model}` ``)
- `apiKey?`, `baseURL?`, `headers?` — literal or `(config) => …` resolvers
- `provider?` — reference a `ChatProviders` preset
- `parameters?`, execution policy (`autoRetry`, `timeout`, …)

Default id example: `openai:deepseek-chat`.

### Option A — per-model `baseURL` (simplest for DeepSeek)

KiboTalk’s `.env.example` already documents DeepSeek as OpenAI-compatible at `https://api.deepseek.com`. Pass that as `baseURL`:

```ts
import { cwd } from 'node:process'
import { defineConfig, loadEnv, requiredEnvFrom } from 'vieval'
import { chatModelFrom, ChatModels } from 'vieval/plugins/chat-models'

export default defineConfig({
  env: loadEnv('test', cwd(), ''),
  plugins: [
    ChatModels({
      models: [
        chatModelFrom({
          aliases: ['reply-agent', 'deepseek-chat'],
          apiKey: config => requiredEnvFrom(config.env, {
            name: 'LLM_OPENAI_API_KEY', // or DEEPSEEK_API_KEY
            type: 'string',
          }),
          baseURL: config =>
            config.env.LLM_OPENAI_BASE_URL ?? 'https://api.deepseek.com',
          inferenceExecutor: 'openai',
          model: 'deepseek-chat', // or deepseek-v4-flash / etc.
        }),
        chatModelFrom({
          aliases: ['judge'],
          apiKey: config => requiredEnvFrom(config.env, {
            name: 'LLM_OPENAI_API_KEY',
            type: 'string',
          }),
          baseURL: config =>
            config.env.LLM_OPENAI_BASE_URL ?? 'https://api.deepseek.com',
          inferenceExecutor: 'openai',
          model: 'deepseek-chat',
        }),
      ],
    }),
  ],
  projects: [/* … */],
})
```

Resolver behavior is covered by unit tests in [`index.test.ts`](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/plugins/chat-models/index.test.ts) (`resolves callback-based model executor parameters from config env`).

At eval time:

```ts
import { modelFromRun, openaiFromRunContext } from 'vieval/plugins/chat-models'
import { createOpenAIProviderAdapter, normalizeOpenAITextOutput } from 'vieval/core/inference-executors'
import { generateText } from '@xsai/generate-text'

const selected = modelFromRun(context, { axis: 'model' })
const runtime = openaiFromRunContext(selected) // { apiKey, baseURL?, model, … }
const adapter = createOpenAIProviderAdapter(runtime.apiKey, runtime.baseURL)
const response = await adapter.runWithRetry(() =>
  generateText({
    ...adapter.provider.chat(runtime.model),
    messages: [/* … */],
  }),
)
const text = normalizeOpenAITextOutput(response)
```

`openaiFromRunContext` validates `parameters.apiKey` / optional `baseURL` ([runtime-config.ts](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/plugins/chat-models/runtime-config.ts)). The OpenAI adapter is explicitly documented as accepting an OpenAI-compatible endpoint ([openai/index.ts](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/core/inference-executors/remote-providers/openai/index.ts)).

### Option B — `ChatProviders` preset (reuse credentials across models)

From the same plugin tests:

```ts
import { chatModelFrom, ChatModels, chatProviderFrom, ChatProviders } from 'vieval/plugins/chat-models'

plugins: [
  ChatProviders({
    providers: [
      chatProviderFrom({
        id: 'deepseek',
        inferenceExecutor: 'openai',
        requiredEnv: { apiKey: 'LLM_OPENAI_API_KEY' },
        optionalEnv: { baseURL: 'LLM_OPENAI_BASE_URL' },
        // or parameters: { baseURL: 'https://api.deepseek.com' }
      }),
    ],
  }),
  ChatModels({
    models: [
      chatModelFrom({
        aliases: ['reply-agent'],
        model: 'deepseek-chat',
        provider: 'deepseek',
      }),
      chatModelFrom({
        aliases: ['judge'],
        model: 'deepseek-chat',
        provider: 'deepseek',
      }),
    ],
  }),
]
```

Resolved model id becomes `deepseek:deepseek-chat`.

### Option C — OpenRouter

README / matrix fixture register OpenRouter with `inferenceExecutor: 'openrouter'` and model ids like `openai/gpt-4.1-mini` (or `deepseek/deepseek-chat` via OpenRouter). Prefer this when keys already live under OpenRouter; for direct DeepSeek API, Option A/B is the documented OpenAI-compatible path.

### Official BYOA call pattern

[`example-pattern-byoa-bring-your-own-agent/agent.ts`](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/tests/projects/example-pattern-byoa-bring-your-own-agent/agent.ts) resolves `modelFromRun`, builds an OpenAI adapter via `createOpenAIFromEnv`, calls `@xsai/generate-text`, and emits request/response/error telemetry. `.env.example` there documents `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`.

**Important:** models with an alias/id containing `"judge"` default to `autoRetry: 3` ([index.test.ts](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/plugins/chat-models/index.test.ts)).

---

## 3. LLM-as-judge and metrics (timing, tokens, scores)

### Evidence types ([assertions guide](https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/learn/assertions-scores-and-metrics.md))

| API | Role | Affects pass/fail / aggregates? |
| --- | --- | --- |
| `expect(...)` | Assertion; throw → case fails | Yes (failed case → exact `0` for aggregation) |
| `context.score(value, kind?)` | Normalized `0..1`; kinds `exact` (default) or `judge` | Yes, when case passes |
| `context.metric(name, value)` | Named metadata (string/number/boolean/null/arrays) | No — report only |
| `expectRubric` / `evaluateAssertions` | Structured rubric assertion (`vieval/core/assertions`) | **Not** auto-wired to case `score`/`metric`; bridge manually |

Case context surface ([dsl/task.ts](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/dsl/task.ts)):

```ts
score: (score: number, kind?: 'exact' | 'judge') => void
metric: (name: string, value: TelemetryAttributeValue) => void
```

Same `kind` within one case: later `score` replaces earlier. Failed/timed-out cases discard custom scores for aggregation (events already emitted may remain in `cases.jsonl` / `events.jsonl`).

### LLM-as-judge pattern

There is **no** built-in “call judge model” helper. Official docs say `expectRubric`’s `judge` callback may use local logic **or** model inference — you supply the call ([assertions guide](https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/learn/assertions-scores-and-metrics.md)).

Recommended wiring for prompt evals:

1. Put **generator** model on `runMatrix` (`model`); resolve with `modelFromRun`.
2. Put **judge** model on `evalMatrix` (`rubricModel` / `judgeModel`); resolve with `modelFromEval`.
3. Call generator → parse JSON → call judge → `score(n, 'judge')` + `metric(...)`.
4. Optionally bridge `expectRubric` outcomes into `score` / `expect(outcome.pass)`.

Matrix fixture [`rubric-sensitivity.eval.ts`](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/tests/projects/example-api-config-matrix/evals/rubric-sensitivity.eval.ts) shows `modelFromEval(context, { axis: 'rubricModel' })` and emitting `{ kind: 'judge', score }` (deterministic stub, no live call).

### Timing and tokens

**Timing**

- Manual: `const startedAt = Date.now()` around each call; `metric('agent.latency_ms', …)` / `metric('judge.latency_ms', …)`.
- Telemetry: `emitChatModelResponseTelemetry(context, { latencyMs, response, provider })` writes an `InferenceResponse` event with `metering.latency_ms` ([telemetry.ts](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/plugins/chat-models/telemetry.ts); used in BYOA `agent.ts`).

**Tokens**

- `emitChatModelResponseTelemetry` runs `extractMeteringDimensions(response)` — copies numeric fields from `response.usage` into `metering.dimensions` (e.g. `prompt_tokens`, `completion_tokens` when the provider returns them).
- Also emit explicit case metrics if you want them in `cases.jsonl` selectors:

```ts
metric('usage.prompt_tokens', usage.prompt_tokens)
metric('usage.completion_tokens', usage.completion_tokens)
```

**Scores**

```ts
score(0.85, 'judge')           // LLM judge
score(schemaOk ? 1 : 0, 'exact') // schema / length / JSON validity
metric('benchmark.case.id', 'cafe-opening-001')
metric('prompt.variant', context.task.matrix.run.promptVariant)
```

Case records also carry timing fields derived from lifecycle events when `--report-out` is set ([reports guide](https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/learn/reports-and-comparisons.md)).

---

## 4. How matrix works for prompt variants

Expansion order ([README](https://github.com/vieval-dev/vieval/blob/main/README.md), [matrices guide](https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/learn/matrices-and-datasets.md)):

1. Project (`vieval.config.*`)
2. Eval (`defineEval({ matrix })`)
3. Task (`defineTask({ matrix })`)

Within each layer: `disable` → `extend` → `override`. Flat `runMatrix: { scenario: [...] }` normalizes to `extend`.

Two scopes:

| Scope | Typical axes | Context path |
| --- | --- | --- |
| `runMatrix` | system under test: `model`, `promptVariant`, `scenario`, `promptLanguage` | `context.task.matrix.run.*` |
| `evalMatrix` | evaluation behavior: `rubric`, `rubricModel` | `context.task.matrix.eval.*` |

Cartesian product: `inferenceExecutors × run rows × eval rows` scheduled tasks per discovered entry. `casesFromInputs` multiplies **cases inside** each scheduled task, not scheduler rows.

**Prompt variant comparison:** put variants on a run axis; task code reads the axis and selects the Velin template / system string. Axes have no built-in behavior — your code must branch.

```ts
// project config
runMatrix: {
  extend: {
    model: ['reply-agent'],
    promptVariant: ['baseline', 'with-segments', 'concise'],
  },
},
evalMatrix: {
  extend: {
    rubricModel: ['judge'],
    rubric: ['strict'],
  },
},
```

```ts
const variant = context.task.matrix.run.promptVariant
const prompt = renderPromptForVariant(variant, matrix.inputs)
```

Official matrix demo README: [example-api-config-matrix/README.md](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/tests/projects/example-api-config-matrix/README.md). Prompt-language reading: [prompt-language-ablation.eval.ts](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/tests/projects/example-api-config-matrix/evals/prompt-language-ablation.eval.ts).

Helper: `chatModelMatrix('alias-a', 'alias-b')` → `{ model: [...] }` for `runMatrix.extend`.

Stable row ids: `context.task.matrix.meta.runRowId` / `evalRowId`.

---

## 5. Artifact / report output

| Flag | Effect |
| --- | --- |
| (default) | Human-readable terminal summary only |
| `--json` | Machine-readable run output on **stdout**; does **not** write files |
| `--report-out <dir>` | Persist report directory tree |

Without `--report-out`, `reportDirectory` is `null` and `vieval report …` has nothing new to read ([reports guide](https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/learn/reports-and-comparisons.md)).

### Path layout

Written by [`writeRunReportArtifacts`](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/cli/report-artifacts.ts):

```text
<report-out>/
  <workspaceId>/
    <projectName|multi-project>/
      <experimentId>/
        <attemptId>/
          <runId>/
            run-summary.json
            events.jsonl
            cases.jsonl
            metrics-summary.json
            otlp/traces.json
            otlp/logs.json
            otlp/metrics.json
            benchmark/          # directory created; reserved
```

Also: CLI cache under `.vieval/cache` inside the project root ([config map](https://github.com/vieval-dev/vieval/blob/main/docs/content/en/config/index.md)).

### What each file holds

| File | Contents |
| --- | --- |
| `run-summary.json` | CLI run output: identities, project status, case summaries/failures, matrix summaries, aggregated scores |
| `events.jsonl` | Ordered envelopes: run/task/case lifecycle, `task.case.score`, `task.case.metric`, `InferenceRequest`/`InferenceResponse`/`InferenceError`, custom events |
| `cases.jsonl` | One normalized final record per task/case: identities, state, timing, retryCount, scores, metrics, optional input/output |
| `metrics-summary.json` | Score counts/sums/averages from case records |
| `otlp/*` | Local OTLP-shaped projections from case records |
| `index/runs.jsonl` | Written by `vieval report index`, **not** by `run` |

### Follow-up commands

```bash
vieval report index .vieval/reports
vieval report cases .vieval/reports/candidate --where state=failed --format jsonl
vieval report analyze .vieval/reports --format json
vieval report compare .vieval/reports/baseline .vieval/reports/candidate \
  --case-key benchmark.case.id --score-kind judge --format table
```

Default compare key preference: metric `benchmark.case.id` → `vieval.case.id` → generated `caseId`. Emit a unique `benchmark.case.id` when datasets reorder ([tasks guide](https://github.com/vieval-dev/vieval/blob/main/docs/content/en/guide/learn/tasks-cases-and-inputs.md)).

Treat artifacts as sensitive (prompts, outputs, metrics, model ids).

---

## 6. Best-practice patterns from official examples

| Pattern | Cite | Takeaway |
| --- | --- | --- |
| Keep agent code out of config | [BYOA `agent.ts`](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/tests/projects/example-pattern-byoa-bring-your-own-agent/agent.ts) | Eval imports product/agent helpers; config only registers models + matrices |
| Role aliases | README + models guide | `agent-*` / `judge-*` aliases stay stable when concrete model changes |
| Run vs eval matrices | [example-api-config-matrix](https://github.com/vieval-dev/vieval/tree/main/packages/vieval/tests/projects/example-api-config-matrix) | Generator axes on `runMatrix`; rubric/judge on `evalMatrix` |
| Layered matrix | [rubric-sensitivity.eval.ts](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/tests/projects/example-api-config-matrix/evals/rubric-sensitivity.eval.ts) | Project defaults + eval/task `extend`/`override`/`disable` |
| Dataset as cases | [example-api-load-datasource-as-cases](https://github.com/vieval-dev/vieval/tree/main/packages/vieval/tests/projects/example-api-load-datasource-as-cases) | Load JSON yourself → `casesFromInputs`; emit `benchmark.case.id` |
| Telemetry around inference | BYOA `agent.ts` + [telemetry.ts](https://github.com/vieval-dev/vieval/blob/main/packages/vieval/src/plugins/chat-models/telemetry.ts) | `emitChatModelRequest/Response/ErrorTelemetry` for reports |
| Prefer aliases in matrix | models guide tip | `modelFromRun` matches id, model name, or alias |
| Estimate fan-out | matrices guide warning | axes × cases × (agent+judge) calls; set concurrency to match provider limits |
| Deterministic first | getting-started | Local no-credential smoke before live LLM evals |
| xsai for calls | package deps + BYOA | vieval uses `@xsai/generate-text` + `@xsai-ext/providers` — aligns with KiboTalk’s xsai rule |

---

## Skeletons for KiboTalk: 3 Japanese reply candidates + LLM judge

Assumes Velin render lives in `@kibotalk/prompts` (existing `ReplySuggestionsPrompt`). Skeletons are adapted from official APIs; not checked into the repo yet.

### Skeleton A — `describeTask` + `casesFromInputs` (preferred)

```ts
// evals/reply-suggestions.eval.ts
import { describeTask, expect } from 'vieval'
import {
  emitChatModelErrorTelemetry,
  emitChatModelRequestTelemetry,
  emitChatModelResponseTelemetry,
  modelFromEval,
  modelFromRun,
  openaiFromRunContext,
} from 'vieval/plugins/chat-models'
import {
  createOpenAIProviderAdapter,
  normalizeOpenAITextOutput,
} from 'vieval/core/inference-executors'
import { generateText } from '@xsai/generate-text'
import { render } from '@velin-dev/core-react' // match packages/prompts usage
import { ReplySuggestionsPrompt } from '@kibotalk/prompts'

type CaseInput = {
  name: string
  level: string
  context: Array<{ speaker: 'user' | 'other', text: string }>
}

const cases: CaseInput[] = [
  {
    name: 'cafe-opening-001',
    level: 'N4',
    context: [{ speaker: 'other', text: 'いらっしゃいませ。何名様ですか？' }],
  },
]

async function chat(
  context: Parameters<typeof modelFromRun>[0],
  modelDef: ReturnType<typeof modelFromRun>,
  messages: Array<{ role: 'system' | 'user' | 'assistant', content: string }>,
) {
  const runtime = openaiFromRunContext(modelDef)
  const adapter = createOpenAIProviderAdapter(runtime.apiKey, runtime.baseURL)
  emitChatModelRequestTelemetry(context, {
    data: { messagesCount: messages.length },
    provider: { id: 'openai', model: runtime.model },
  })
  const startedAt = Date.now()
  try {
    const response = await adapter.runWithRetry(() =>
      generateText({
        ...adapter.provider.chat(runtime.model),
        messages,
      }),
    )
    emitChatModelResponseTelemetry(context, {
      latencyMs: Date.now() - startedAt,
      provider: { id: 'openai', model: runtime.model },
      response,
    })
    return {
      text: normalizeOpenAITextOutput(response),
      latencyMs: Date.now() - startedAt,
      usage: (response as { usage?: Record<string, number> }).usage,
    }
  }
  catch (error) {
    emitChatModelErrorTelemetry(context, {
      error,
      provider: { id: 'openai', model: runtime.model },
    })
    throw error
  }
}

describeTask('reply-suggestions-json', ({ casesFromInputs }) => {
  casesFromInputs('reply', cases, async ({ matrix, metric, score, ...context }) => {
    metric('benchmark.case.id', matrix.inputs.name)

    const agent = modelFromRun(context, { axis: 'model' })
    const judge = modelFromEval(context, { axis: 'rubricModel' })
    const variant = String(context.task.matrix.run.promptVariant ?? 'baseline')

    // 1) Generate: Velin → user message; expect JSON array of 3
    const userPrompt = await render(ReplySuggestionsPrompt, {
      context: matrix.inputs.context,
      level: matrix.inputs.level,
    })
    // branch on `variant` when comparing prompt ablations

    const agentResult = await chat(context, agent, [
      { role: 'user', content: userPrompt },
    ])
    metric('agent.latency_ms', agentResult.latencyMs)
    if (agentResult.usage?.prompt_tokens != null)
      metric('agent.prompt_tokens', agentResult.usage.prompt_tokens)
    if (agentResult.usage?.completion_tokens != null)
      metric('agent.completion_tokens', agentResult.usage.completion_tokens)

    const parsed = JSON.parse(agentResult.text) as unknown
    expect(Array.isArray(parsed)).toBe(true)
    expect((parsed as unknown[]).length).toBe(3)
    for (const item of parsed as Array<Record<string, unknown>>) {
      expect(typeof item.meaningZh).toBe('string')
      expect(typeof item.targetText).toBe('string')
      expect(typeof item.reading).toBe('string')
      expect(Array.isArray(item.segments)).toBe(true)
    }
    score(1, 'exact') // schema gate

    // 2) Judge: second model call → normalized 0..1
    const judgeResult = await chat(context, judge, [
      {
        role: 'system',
        content:
          'You score Japanese reply-coach suggestions. Reply JSON only: {"score":0-1,"reason":"..."}',
      },
      {
        role: 'user',
        content: JSON.stringify({
          level: matrix.inputs.level,
          context: matrix.inputs.context,
          suggestions: parsed,
          rubric: context.task.matrix.eval.rubric,
        }),
      },
    ])
    metric('judge.latency_ms', judgeResult.latencyMs)
    const judgment = JSON.parse(judgeResult.text) as { score: number, reason: string }
    metric('judge.reason', judgment.reason)
    score(judgment.score, 'judge')
    expect(judgment.score).toBeGreaterThanOrEqual(0.7)
  })
})
```

Matching config axes:

```ts
runMatrix: {
  extend: {
    model: ['reply-agent'],
    promptVariant: ['baseline', 'concise'],
  },
},
evalMatrix: {
  extend: {
    rubric: ['strict'],
    rubricModel: ['judge'],
  },
},
```

### Skeleton B — lower-level `defineEval` / `defineTask` (matrix-heavy)

Use when you need task-local `override` like the rubric-sensitivity fixture:

```ts
// evals/reply-suggestions-matrix.eval.ts
import { defineEval, defineTask } from 'vieval/config'
import { modelFromEval, modelFromRun } from 'vieval/plugins/chat-models'

export default defineEval({
  name: 'reply-suggestions-matrix',
  description: 'Ablate promptVariant × judge rubric.',
  matrix: {
    runMatrix: {
      extend: { promptVariant: ['baseline', 'with-segments'] },
    },
  },
  task: defineTask({
    id: 'reply-suggestions-matrix',
    matrix: {
      evalMatrix: {
        override: { rubric: ['strict'] },
      },
    },
    async run(context) {
      const agent = modelFromRun(context, { axis: 'model' })
      const judge = modelFromEval(context, { axis: 'rubricModel' })
      const variant = context.task.matrix.run.promptVariant
      // … same generate + judge calls as Skeleton A …
      void agent
      void judge
      void variant
      return {
        scores: [
          { kind: 'exact', score: 1 },
          { kind: 'judge', score: 0.8 },
        ],
      }
    },
  }),
})
```

---

## Recommended layout for KiboTalk

Keep **product prompts** in `packages/prompts` (Velin). Add a thin **eval package or app root project** that depends on `vieval` + `@kibotalk/prompts` + xsai — do not embed eval matrices inside the prompt package.

Suggested shape:

```text
packages/prompts/          # Velin TSX (unchanged source of truth)
evals/                     # or packages/prompt-evals/
  vieval.config.ts         # ChatModels (DeepSeek via openai + baseURL), run/eval matrices
  evals/
    reply-suggestions.eval.ts
  fixtures/cases/*.json    # conversation snippets → casesFromInputs
.vieval/reports/           # gitignored artifact output
```

- **runMatrix:** `model`, `promptVariant` (which Velin props / template), optional `level`.
- **evalMatrix:** `rubric`, `rubricModel`.
- **Calls:** xsai (`generateText` / same stack as `apps/api`), resolved via `openaiFromRunContext` so DeepSeek is just `inferenceExecutor: 'openai'` + `baseURL: https://api.deepseek.com`.
- **Evidence:** `exact` for JSON/schema; `judge` for quality; metrics for latency/tokens + `benchmark.case.id`.
- **Run:** `pnpm exec vieval run --config ./evals/vieval.config.ts --report-out .vieval/reports`.

This matches vieval’s BYOA pattern: prompts and rendering stay product code; vieval only schedules variants and records scores.
