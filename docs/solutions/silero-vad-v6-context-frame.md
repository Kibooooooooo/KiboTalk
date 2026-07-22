---
module: audio-vad
tags: [vad, silero, transformers-js, playground]
problem_type: integration-bug
---

# Silero VAD v6.2 needs a 64-sample context frame (576 input, not 512)

## 症状 / Symptom

Upgrading the Silero VAD model from `onnx-community/silero-vad` (v5) to
`BricksDisplay/silero-vad-6.2` (v6.2) made VAD **completely fail to detect
speech**: the live probability stayed near 0.0005–0.003 even while speaking
loudly, so no segment ever crossed the 0.5 threshold. v5 worked fine with the
same code.

## 原因 / Cause

v6 changed the input frame format. The model now expects **576 samples per
chunk = 64-sample context + 512-sample audio**, where the context is carried
across calls (zeros on the first call, then the last 64 samples of the previous
chunk). v5 took 512 raw samples with no context.

We were feeding 512 raw samples (the v5 frame), so the conv front-end received
the wrong-sized input and produced garbage features → near-zero probability.
The ONNX graph has a dynamic input axis, so 512 was *accepted* (no error) but
produced wrong output — which made it look like a "threshold too high" problem
rather than a wiring bug.

Source of truth: `snakers4/silero-vad` `src/silero_vad/utils_vad.py`
`VADIterator.__call__` — `context_size = 64 if sr == 16000 else 32`, then
`x = torch.cat([self._context, x], dim=1)` before inference, and
`self._context = x[..., -context_size:]` after.

## 修复 / Fix

`apps/playground/src/audio/silero-vad.ts` `createSileroInfer` now carries a
`context` buffer (length `contextSize`, zeros initially) and prepends it to each
512-sample chunk → 576-sample input. After inference, `context = chunk.slice(-contextSize)`.
v5 variants set `contextSize = 0` and feed 512 raw, unchanged.

Both variants are selectable in the playground (`SILERO_VARIANTS`); switching
requires stop → start (model reload + state reset).

## 证据 / Evidence

- `apps/playground/src/audio/silero-vad.ts` — `createSileroInfer(variant, sampleRate)`, `contextSize` logic.
- Debug run logs showed `output.first ≈ 0.0005` with `chunkLen: 512, inputLen: 512`
  (pre-fix) vs rising probability after the 576-input fix.

## 参考 / References

- Upstream: https://github.com/snakers4/silero-vad/blob/master/src/silero_vad/utils_vad.py
- v6.2 changelog: https://github.com/snakers4/silero-vad/issues/2 (window_size deprecated; fixed 512 @16kHz + carried context)
- ADR 0002 (local STT) is unrelated — this is a VAD-frame issue, not routing.
