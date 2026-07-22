---
module: api
tags: [dotenv, env, apps-api, config]
problem_type: config
---

# `apps/api/src` → repo root `.env` is `../../../.env`, not `../../.env`

## 症状 / Symptom

`apps/api` started but every `/stt` request failed with
`HTTP 500: Missing STT config for provider "openai"`, even though `.env` at the
repo root had `STT_OPENAI_*` set. `process.env.STT_*` were undefined inside the
server.

## 原因 / Cause

`apps/api/src/index.ts` loaded `.env` with
`resolve(dirname(fileURLToPath(import.meta.url)), '../../.env')`.
`import.meta.url` points at `apps/api/src/index.ts`, so:

- `../..` → `apps/api/src` → `apps` (one level short of repo root)
- `../../.env` → `apps/.env` (does not exist) → dotenv silently loads nothing.

The correct relative depth is `../../../` → repo root.

## 修复 / Fix

Use `resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env')`.
Tests import `app` directly and set `process.env` themselves, so this line
never runs in tests — the bug only surfaced at dev/runtime.

## 证据 / Evidence

- `apps/api/src/index.ts` — `config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') })`.
- Commit `37eeaa6` (fix(api): correct dotenv path to repo root).

## 参考 / References

- `.env.example` documents the `STT_OPENAI_*` / `LLM_*` naming.
- AGENTS.md "Keys in env, never client".
