---
module: prompts
tags: [vieval, reply-suggestions, furigana, schema, deepseek]
date: 2026-07-23
---

# Reply suggestions — vieval prompt / schema ablation（2026-07-23）

## 元数据

| 项 | 值 |
| --- | --- |
| Generator | DeepSeek V4-flash（`LLM_OPENAI_*`），`thinking: disabled`（贴近线上 TTFT） |
| Judge | 同模型，`thinking: enabled` |
| Harness | `vieval@0.0.12` + xsai `generateText`（BYOA）；配置 `vieval.config.ts`，用例 `evals/fixtures/cases.ts`，变体 `evals/lib/variants.ts` |
| 分数 | `exact` = schema 校验；`judge` = LLM 裁判；另有确定性 `kana_over_ruby_rate` / `particle_miss_rate` |
| 原始产物 | `.vieval/reports/local/reply-suggestions/`（gitignore） |

本报告覆盖同日三轮实验：

1. **prompt-ablation** — 短对话、角色/简洁度消融  
2. **ruby-ablation** — 假名叠假名 / 助词专项（短～中等对话）  
3. **multi-turn-ruby** — 加长多轮 + 合并变体 `ruby_kanji_no_phrase` 全量重跑  

---

## 背景与假设

生产 prompt（`packages/prompts` → Velin）当时是：

- **单条 user message**（无 system role）
- Schema：`meaningZh` / `targetText` / `reading`（整句假名）/ `segments[]`
- 对 segment 仅写「optional reading，furigana only when surface has kanji」——约束偏软

观测问题：模型经常在**纯假名 surface**上也填 `reading`（如 `です`→`です`），UI 出现「假名上叠假名」。整句 `reading` 与 segment ruby **重复**，疑似无用。

假设：

- H1：system/user 拆分能提高内容质量（多样性、贴合上一轮）
- H2：显式 FORBIDDEN + 正反例能压住假名叠假名
- H3：去掉顶层 `reading` 不影响可用性，且可减少冗余

---

## 各 promptVariant 设计说明

实现均在 `evals/lib/variants.ts`（生产仍默认 `baseline`，未自动切换）。

### `baseline`

- **来源**：`renderReplySuggestionsPrompt`（现网 Velin 组件）
- **消息**：仅 `user`
- **Schema**：`meaningZh`, `targetText`, `reading`, `segments`（必填）
- **Ruby 措辞**：reading「optional…only when surface has kanji」——无 BAD 示例、无 NEVER
- **校验**：`requiresPhraseReading: true`；后几轮起对假名叠假名 **硬失败**

### `system_split`

- **动机**：验证真 system role 是否优于「教练说明塞进 user」
- **消息**：`system` = 角色 + 难度 + 多样性 + STRICT JSON；`user` = level + 对话 + schema
- **Schema**：与 full schema 相同（含顶层 `reading`）+ 共享 `RUBY_RULES`（后几轮）

### `schema_lite`（仅第 1 轮）

- **动机**：去掉 `segments`，只保留三字段，测延迟与内容质量
- **Schema**：`meaningZh`, `targetText`, `reading`；无 segments
- **代价**：UI 无法做助词高亮 / 逐词 ruby（靠 fallback）

### `concise_example`（仅第 1 轮）

- **动机**：缩短 schema 说明 + **一条 few-shot JSON**，并强调三条建议要不同策略
- **Schema**：仍要求 segments；示例含正确「假名无 reading / 汉字有 reading」

### `ruby_kanji_only`

- **动机**：专治假名叠假名
- **设计要点**：
  - 共享 `RUBY_RULES`（ONLY 汉字可有 `reading`；NEVER 假名段；NEVER reading===surface；助词/标点 role）
  - **BAD / GOOD** 对照示例
  - 完整 3 条 JSON example（含顶层 `reading`）
- **消息**：教练文案 + schema 仍可放在单条 `user`（本实现）
- **校验**：必填顶层 `reading` + segments；假名叠假名硬失败

### `no_phrase_reading`

- **动机**：废除顶层 `reading`，ruby 只来自 `segment.reading`
- **Schema 键**：仅 `meaningZh`, `targetText`, `segments`
- **Ruby 规则**：有 `RUBY_RULES`，但 **无** BAD/GOOD 对照（弱于 `ruby_kanji_only`）
- **校验**：出现非空顶层 `reading` → 硬失败（后几轮）

### `ruby_kanji_no_phrase`（合并，第 3 轮起）

- **动机**：结合上两者——kanji-only 正反例 **且** 禁止顶层 `reading`
- **Schema**：同 `no_phrase_reading` 的键；文案含 BAD/GOOD +「禁止顶层 reading」的 BAD 例
- **校验**：同 no-phrase + kana forbid

### `particle_ruby_strict`

- **动机**：在 system_split 上再收紧助词切分（は/が/を 独立段；です/ます 为 content 且无 reading）
- **副作用**：长句时更容易 surfaces 拼不回 `targetText`；有时漏顶层 `reading`

### 共用 `RUBY_RULES`（摘要）

```text
- segments 左到右覆盖 targetText；surface 拼接必须相等
- reading 仅当 surface 含漢字
- 禁止假名-only surface 带 reading；禁止 reading === surface
- role: particle | punct | content（助词列表见 variants.ts）
```

### Judge 维度（第 2 轮起）

除 level_fit / naturalness / diversity / usefulness / schema_faithfulness 外，强调：

- **furigana_quality** — 假名叠假名重罚  
- **particle_quality** — 助词独立与 role  

确定性校验结果会作为 `deterministicAnnotationIssues` 喂给 judge。

---

## 第 1 轮：prompt-ablation（短对话）

| 项 | 值 |
| --- | --- |
| Experiment | `prompt-ablation` / `attempt-a` |
| Run | `run-1784778490492-f8631afe` |
| 矩阵 | 4 variants × 6 cases = 24（全过） |
| 用例 | 便利店/咖啡店开场、职场、STT 噪声、道歉、约电影等（偏短） |
| 裁判维度 | 尚无独立 furigana/particle 维 |

### 提示词集合

`baseline` · `system_split` · `schema_lite` · `concise_example`

### 结果（variant 均值）

| Variant | judge | agent ms | prompt tok | 备注 |
| --- | ---: | ---: | ---: | --- |
| **system_split** | **0.89** | 3146 | 312 | 内容质量最好；diversity 0.97 |
| concise_example | 0.85 | 2822 | 435 | diversity = 1.0；prompt 更长 |
| schema_lite | 0.82 | **1687** | **196** | 最快；naturalness 偏低 |
| baseline | 0.82 | 3675 | 358 | 现网；有用性/多样性偏弱 |

Judge 平均约 9–19s（thinking on），`reasoning_tokens` 约 870–1660。同 case 两次 judge 有抖动。

### 本轮结论

- 角色拆分（`system_split`）值得采用。  
- 短用例 + 松 schema 校验时，**看不出**假名叠假名灾难（exact 全 1）——需专用校验与汉字向用例。

---

## 第 2 轮：ruby-ablation（假名/助词专项）

| 项 | 值 |
| --- | --- |
| Experiment | `ruby-ablation` / `attempt-c` |
| Run | `run-1784780118331-be00bde8` |
| 矩阵 | 5 variants × 12 cases = 60（全过） |
| 用例 | `RUBY_FOCUS`：面试/看病/看房/投诉/商务等（当时多为 3～4 轮） |
| 新增 | 假名叠假名硬校验；judge 的 furigana/particle 维 |

### 提示词集合

`baseline` · `system_split` · `ruby_kanji_only` · `no_phrase_reading` · `particle_ruby_strict`

### 结果

| Variant | schema OK | 假名叠假名率 | furigana | particle | judge |
| --- | ---: | ---: | ---: | ---: | ---: |
| **ruby_kanji_only** | **83%** | **8%** | **0.92** | **0.93** | **0.91** |
| no_phrase_reading | 67% | 8% | 0.88 | 0.75 | 0.82 |
| particle_ruby_strict | 17% | 25% | 0.76 | 0.83 | 0.79 |
| system_split | 33% | 42% | 0.65 | 0.77 | 0.76 |
| **baseline** | **8%** | **92%** | **0.15** | 0.95 | 0.53 |

典型 baseline 脏例：`{"surface":"です","reading":"です"}`、`{"surface":"は","reading":"は"}`。助词 role 本身尚可；主要烂在 furigana。

### 本轮结论

- **现网 soft 措辞不够**：模型把「有 reading 字段」理解成「每段都填」。  
- **正反例 + NEVER**（`ruby_kanji_only`）是最有效干预。  
- `particle_ruby_strict` 过严，concat / 漏字段多，不推荐单独上线。

---

## 第 3 轮：multi-turn-ruby（加长多轮 + 合并变体）

| 项 | 值 |
| --- | --- |
| Experiment | `multi-turn-ruby` / `attempt-a` |
| Run | `run-1784781743436-47e280f2` |
| 矩阵 | 6 variants × 14 cases = 84（**83 过 / 1 败**） |
| 失败 | `system_split` × `parent-teacher-n2`：模型输出 JSON 解析失败（非 schema 语义） |
| 用例 | 加长至 5～7 轮（含 `job-interview-full-arc-n2`）；`RUBY_FOCUS` 14 条全多轮 |
| 新增变体 | **`ruby_kanji_no_phrase`** |

### 提示词集合

上一轮全部 + `ruby_kanji_no_phrase`（kanji-only 正反例 ∧ 无顶层 reading）

### 结果

| Variant | schema OK | 假名叠假名 | furigana | particle | judge | agent ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **ruby_kanji_only** | **100%** | **0%** | **1.00** | 0.88 | **0.97** | 7035 |
| **ruby_kanji_no_phrase** | 64% | 7% | **0.94** | 0.82 | 0.83 | **6240** |
| no_phrase_reading | 43% | 7% | 0.84 | 0.85 | 0.86 | 6698 |
| system_split | 43% | 46% | 0.73 | 0.85 | 0.85 | 7988 |
| particle_ruby_strict | 21% | 14% | 0.84 | 0.91 | 0.88 | 5676 |
| baseline | 21% | **79%** | 0.31 | 0.89 | 0.63 | 6811 |

#### 合并变体细节

- **顶层 `reading`**：本轮未出现「reading forbidden」硬错 → 模型能听话去掉整句 reading。  
- **soft-fail 主因**：`segments surfaces do not concat to targetText`（长句切段不稳），不是假名叠假名。  
- Furigana 仍优（0.94），但完整 schema 率低于「仍保留顶层 reading」的 `ruby_kanji_only`。

### 本轮结论

1. 假名问题：继续以 **`ruby_kanji_only` 规则**（FORBIDDEN + 正反例）为准。  
2. 顶层 `reading`：可删；合并变体证明可省略。生产类型可改为仅 `meaningZh` / `targetText` / `segments`。  
3. 合并版本轮因 **concat** 略吃亏；上线时可「kanji-only 文案 + 无顶层 reading」，并对 concat 做客户端兜底或后处理。  
4. `baseline` 在多轮+硬校验下仍不可接受（假名叠假名 ~79–92%）。

---

## 总推荐（截至 2026-07-23）

| 优先级 | 动作 |
| --- | --- |
| P0 | ~~生产 prompt 采用 kanji-only ruby 规则 + BAD/GOOD~~ **已迁入** `packages/prompts`（`buildReplySuggestionsMessages`） |
| P0 | ~~删除顶层 `reading`~~ **已废弃**（类型 optional；prompt 禁止输出） |
| P1 | ~~system/user 拆分~~ **已迁入** |
| P2 | 不单独上线 `particle_ruby_strict`；助词规则保留在 `RUBY_RULES` 即可 |
| — | 每次 `pnpm eval` 后更新本目录报告（见 [README](./README.md)） |

生产实现对齐变体：**system_split 角色文案 + ruby_kanji_no_phrase schema**（`REPLY_SUGGESTIONS_SYSTEM` + `ReplySuggestionsUserPrompt`）。

## 相关路径

- 变体实现：`evals/lib/variants.ts`  
- Schema 校验：`evals/lib/schema.ts`  
- Judge：`evals/lib/judge.ts`  
- 用例：`evals/fixtures/cases.ts`  
- 配置：`vieval.config.ts`  
- 研究笔记：`docs/brainstorm/2026-07-23-vieval-prompt-eval.md`  
