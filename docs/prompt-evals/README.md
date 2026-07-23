# Prompt evaluation reports

Reply-coach（及后续 LLM）提示词 / schema 的 **vieval benchmark 报告**。

机器产物（`cases.jsonl` / `events.jsonl`）在 `.vieval/reports/`（gitignore）。本目录只存**可审阅的人类报告**：提示词怎么设计、测了什么、数字结果、结论。

## 何时写报告

每次跑完 `pnpm eval`（或等价 vieval benchmark）后，**必须**在本目录新增或更新一篇报告，再改生产 prompt / schema。不要只口头总结。

## 命名

```text
docs/prompt-evals/YYYY-MM-DD-<topic>.md
```

例：`2026-07-23-reply-suggestions-vieval.md`

## 报告应包含

1. **元数据**：日期、模型、generator/judge thinking、experiment id、report 路径、用例集
2. **动机**：本轮要验证什么假设
3. **每个 promptVariant 的设计**：角色拆分、schema 字段、约束与示例（可贴关键片段；完整实现见 `evals/lib/variants.ts`）
4. **结果表**：schema OK / exact / judge / furigana / particle / latency 等（按本轮指标）
5. **解读与结论**：推荐迁入生产的变体；明确不采用的变体及原因
6. **后续**：未重跑的缺口、建议的下一次 ablation

## 索引

| 报告 | 主题 |
| --- | --- |
| [2026-07-23-reply-suggestions-vieval.md](./2026-07-23-reply-suggestions-vieval.md) | Reply 三候选：角色拆分、furigana/助词 schema、多轮重跑 |
