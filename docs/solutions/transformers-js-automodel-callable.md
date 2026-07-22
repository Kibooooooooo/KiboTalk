---
module: audio-vad
tags: [transformers-js, silero, playground]
problem_type: api-misuse
---

# transformers.js `AutoModel` is callable — use `model({...})`, not `model.__call__({...})`

## 症状 / Symptom

VAD inference threw `TypeError: model.__call__ is not a function` on the first
chunk when running Silero VAD via `@huggingface/transformers` `AutoModel`.

## 原因 / Cause

`AutoModel.from_pretrained` returns a `PreTrainedModel` instance that **extends
`Callable`** — the instance is itself a callable closure (delegates to
`_call` → `forward`). It is *not* a class with a `__call__` method. Calling
`model.__call__({...})` treats `__call__` as a property, which doesn't exist on
the callable instance.

## 修复 / Fix

Invoke the model directly: `const out = await model({ input, sr, state })`.
The TS types don't expose the callable shape for custom models, so cast the
instance to a function type (`SileroForward` in
`apps/playground/src/audio/silero-vad.ts`).

## 证据 / Evidence

- `apps/playground/src/audio/silero-vad.ts` — `type SileroForward = (args: {...}) => Promise<{...}>` and `out = await model({ input, sr, state })`.

## 参考 / References

- transformers.js: `PreTrainedModel extends Callable` (the instance delegates to `_call`).
