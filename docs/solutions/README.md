# Solutions

Past fixes and known pitfalls, one file per issue. Read the relevant solution
before touching a documented area; add a new file when you solve a non-obvious bug.

## File format

YAML frontmatter + structured body:

```markdown
---
module: <area, e.g. audio-vad | api | llm | stt | speaker | playground | ui>
tags: [<keywords>]
problem_type: <integration-bug | config | api-misuse | regression | ...>
---

# Title

## 症状 / Symptom
## 原因 / Cause
## 修复 / Fix
## 证据 / Evidence (file:line, commit)
## 参考 / References
```

## Index

- `silero-vad-v6-context-frame.md` — Silero VAD v6.2 needs 64-sample context (576 input), not 512 raw.
- `transformers-js-automodel-callable.md` — `AutoModel.from_pretrained` returns a callable; invoke `model({...})`, not `model.__call__({...})`.
- `api-dotenv-path.md` — `apps/api/src` → repo root is `../../../.env`, not `../../.env`.
