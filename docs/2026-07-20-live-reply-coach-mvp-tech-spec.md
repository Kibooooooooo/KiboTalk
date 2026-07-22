# Live Reply Coach — MVP 需求与技术选型

- **状态**：技术方案草案
- **标签**：product, mvp, architecture, react, electron, pwa
- **关联**：[产品想法](./2026-07-16-live-reply-coach-language-assist.md)
- **作者**：路路（与神奈子需求对齐后整理）

## 摘要

**一句话**：真人外语开口教练——说话人识别区分用户与对方，只在对方说完时出回复建议；用户实际说了什么也要进同一条对话流，影响下轮建议。

**交付形态**：

| 端 | 形态 | 音频能力 |
|----|------|----------|
| **移动端（iPhone 等）** | 纯 Web / PWA，响应式 UI | 仅麦克风（当面场景） |
| **桌面浏览器** | 同一套 Web 应用，响应式 UI | 麦克风 |
| **桌面原生壳（P1）** | Electron 薄入口，与 Web **共用 packages** | 麦克风 + Mac 系统声音 |

组织方式参考 [AIRI](https://github.com/moeru-ai/airi)：**具体实现放在 `packages/`，`apps/` 只是各平台的薄入口**（见 §2.2）。

---

## 1. MVP 产品需求

### 1.1 唯一主模式：AI 实景对话

不做「AI 语音陪练」「AI 文字问答」（可留灰色入口，会后迭代）。

### 1.2 核心用户流程

```text
Onboarding（目标语 / 水平 / 场景 / 声纹录制）
    → 开始会话
    → 持续听音频 → VAD 切段 → 说话人判定
        → other 说完：STT → 写入对话 → 生成 3 条候选（中文 + 目标语 + 读音）
        → user 说完：STT → 写入对话 → 不出候选
    → 循环
    → 结束会话 → 文字回顾（小结 + 本轮句型）
```

### 1.3 功能清单

#### P0 — 必须交付

| ID | 模块 | 需求 | 验收 |
|----|------|------|------|
| F01 | 声纹 Enrollment | 开始前读固定文案，建立 user 声纹 | 后续能区分 user / other |
| F02 | 说话人识别 | 每段音频判定 `user` \| `other` | 对方轮次不误触为用户 |
| F03 | VAD + STT | 按「一句」切段并转写；转写**可见但不可编辑**（ASR 错误由 LLM 上下文消化） | 时间轴显示转写原文 |
| F04 | 回复候选 | **仅** `speaker === 'other'` 时生成 **3 条** | 含 meaningZh / targetText / reading |
| F05 | 用户轮次感知 | `speaker === 'user'` 时 STT 写入对话，**不**出候选 | 下轮 LLM 能看到用户实际说的 |
| F06 | 语言水平 | N5–N1（或三档）影响 prompt | N5 与 N1 输出可肉眼区分 |
| F07 | 场景 | 至少「便利店」「通用」 | 影响 system prompt |
| F08 | 对话时间轴 | 单条 turn 流，按 speaker 区分展示 | 可回看每轮原文 |
| F09 | 结束回顾 | 会话结束生成文字小结 | 可复制 |
| F10 | 响应式 UI | iPhone Safari + Mac Chrome/Safari 同一 URL | 竖屏/宽屏布局可用 |
| F11 | PWA（移动） | 可「添加到主屏幕」 | 全屏、少地址栏干扰 |

#### P1 — 演示加分

| ID | 需求 |
|----|------|
| F12 | Mac 系统音频（Teams / 视频里的对方） |
| F13 | 「换一批」重新生成候选 |
| F14 | 点选候选高亮（**不进** LLM 上下文，上下文以 STT 为准） |
| F15 | [vieval](https://github.com/vieval-dev/vieval) 提示词评估（CI / 本地） |

#### 明确不做（MVP）

| 不做 | 原因 |
|------|------|
| 候选编辑 / 自建 | 团队决策砍掉；不够好则「换一批」 |
| TTS / AI 代说 | 产品定位是用户自己开口 |
| iPhone 通话监听 | Web / PWA 做不到 |
| 登录账号 | 本地会话即可 |
| 离线 LLM | LLM 走在线 API。本地 ASR 可选（低延迟，见 §2.9 本地 STT） |

### 1.4 数据模型

```ts
type Speaker = 'user' | 'other'

type ConversationTurn = {
  id: string
  speaker: Speaker
  text: string
  startedAt: number
  endedAt: number
  suggestions?: ReplyCandidate[] // 仅 other 轮次
}

type ReplyCandidate = {
  id: string
  meaningZh: string
  targetText: string
  reading: string
}
```

**规则**

- 一条 `ConversationTurn[]`，不按 speaker 拆两套存储
- LLM 上下文 = 全部 turns（含用户 STT 结果）
- 点选候选 ≠ 用户说了什么；**以 STT 为准**

### 1.5 与神奈子原型图对齐

| 她图里的 | MVP |
|----------|-----|
| 录声纹 | ✅ F01 |
| 听对方 → 出建议 | ✅ F02–F04 |
| 感知用户说了什么 | ✅ F05 |
| 语言水平 N5/N1 | ✅ F06 |
| 结束小结 | ✅ F09 |
| AI 语音 / AI 问答 | ❌ |
| 候选编辑 | ❌ 已砍 |

---

## 2. 技术栈选型

### 2.1 总览

| 层 | 选型 | 参考 |
|----|------|------|
| Monorepo | pnpm workspace + **Turborepo** | [moeru-ai/airi](https://github.com/moeru-ai/airi) |
| 主 UI | **React** + Vite | — |
| 样式 | **Tailwind CSS** + **shadcn/ui** | — |
| 会话编排 | `packages/conversation` | 借鉴 [DeepChat](https://github.com/thinkinaixyz/deepchat) Tape 思路 |
| 语音 Pipeline | `packages/pipeline` | [webai-example-realtime-voice-chat](https://github.com/proj-airi/webai-example-realtime-voice-chat)（VAD + STT，无 TTS） |
| 提示词 | **Velin** `@velin-dev/core-react`（TSX） | [moeru-ai/velin](https://github.com/moeru-ai/velin) |
| LLM | **xsai** | AIRI 生态 |
| STT | 走代理（OpenRouter：`openai/gpt-4o-transcribe` 默认，`groq/whisper-large-v3-turbo` fallback）；本地可选（mlx-qwen3-asr） | 见 §2.9 |
| 服务端 | **Hono** 薄代理（转发 LLM + STT，藏 key，streaming） | — |
| 部署 | **Railway** 常驻进程（无超时，git push 部署） | — |
| Prompt 评估 | **vieval**（根目录 config + `evals/`） | [vieval-dev/vieval](https://github.com/vieval-dev/vieval) |
| 移动 | **PWA**（`apps/web` 构建） | — |
| 桌面 Web | 同一 `packages/*`，`apps/web` 响应式 | 对齐 AIRI「浏览器入口」角色，非其命名 |
| 桌面系统音 | **Electron** 薄入口（P1） | AIRI `stage-tamagotchi` 同款模式 |

### 2.2 Monorepo 结构（对齐 AIRI 的真实做法）

#### AIRI 实际怎么拆的

查了 [airi 仓库](https://github.com/moeru-ai/airi)：

| 位置 | 职责 | 例子 |
|------|------|------|
| **`packages/`** | **绝大部分实现**：UI、页面、业务逻辑、音频 pipeline | `stage-ui`、`stage-pages`、`stage-layouts`、`pipelines-audio`、`core-agent` |
| **`apps/`** | **薄入口**：Vite / Electron / Capacitor 配置、平台特有胶水 | `stage-web`、`stage-tamagotchi`、`stage-pocket` |

要点：

1. **`apps/stage-web` 和 `apps/stage-tamagotchi` 都直接 `workspace:^` 依赖同一批 packages**（`stage-ui`、`stage-pages` 等），不是「桌面加载 web 的 dist」。
2. 桌面端用 **electron-vite 自己再编一版**，与 web 入口**共享 packages、各自打包**。
3. 我们没有「舞台」概念，**不沿用 `stage-*` 命名**；只借鉴「packages 实现 + apps 入口」分层。

#### 本项目的目录

```text
live-reply-coach/
├── apps/
│   ├── playground/             # 功能验证入口：极简前端，测 pipeline 各模块（见 §2.7）
│   ├── web/                    # 薄入口：Vite dev、生产构建、PWA manifest
│   ├── api/                    # Hono 薄代理：/llm /stt 转发，藏 key，streaming；部署 Railway
│   └── desktop/                # P1：Electron 薄入口（主进程音频、窗口）
├── packages/
│   ├── ui/                     # shadcn 组件 + design tokens
│   ├── pages/                  # 路由与页面（会话、设置、回顾）
│   ├── app-shared/             # 跨页面状态、hooks、布局
│   ├── conversation/           # Session / Turn store
│   ├── pipeline/               # VAD → speaker → STT → 触发 LLM
│   ├── speaker/                # enrollment + 在线判定
│   ├── prompts/                # Velin TSX 模板
│   ├── llm/                    # xsAI 封装
│   ├── audio/                  # AudioSource 抽象（mic | system）
│   └── shared/                 # types、constants
├── evals/                      # vieval 用例（*.eval.ts）+ fixture
├── vieval.config.ts            # 根目录，与 vieval 官方仓库一致
├── turbo.json
└── pnpm-workspace.yaml
```

**`apps/web` 里通常只有**：`index.html`、`main.tsx`、`vite.config.ts`、`pwa` 插件——然后 `import` 来自 `@lrc/pages`、`@lrc/ui`。

**`apps/desktop`（P1）里通常只有**：Electron main/preload、打包配置——渲染进程同样 `import` 同一批 packages。

### 2.3 vieval：不需要 `eval-runner` app

[vieval 官方仓库](https://github.com/vieval-dev/vieval) 的做法：

- 根目录 `vieval.config.ts`
- 根目录 `evals/`（`pnpm-workspace` 成员）
- 根 `package.json` 脚本：`pnpm -F vieval eval:run` 或 `vieval run --config ./vieval.config.ts`
- **没有**单独的 `apps/eval-runner`

eval 直接 import `packages/prompts`、`packages/llm` 的业务函数，不必经过 UI 入口。

根 `package.json` 示例：

```json
{
  "scripts": {
    "eval": "vieval run --config ./vieval.config.ts"
  }
}
```

### 2.4 语音 Pipeline

**数据流（单段）**：

```text
AudioSource (getUserMedia | Electron 主进程注入 system PCM)
    ↓
VAD（一句结束）
    ↓
SpeakerGate（本地 enrollment embedding → user | other）
    ↓
STT（可与 SpeakerGate 并行）
    ↓
conversation.appendTurn({ speaker, text })
    ↓
if other → Velin(repliesPrompt) → xsAI → 3 candidates
if user  → 结束，等待下一轮
```

**会话状态机（含打断与多轮无用户）**：

```text
                         ┌──────────────────────────────────┐
                         ▼                                  │
  ┌──────┐  VAD 检到语音   ┌──────────────┐  停顿 ≥ 阈值     │
  │ IDLE │ ──────────────→ │ OTHER_SPEAKING│ ─────────────┐   │
  └──────┘  speaker=other  └──────────────┘             │   │
      │                                                  ▼   │
      │  VAD 检到语音                              append other turn
      │  speaker=user                                   │      │
      ▼                                                 ▼      │
  ┌──────────────┐  停顿 ≥ 阈值            ┌──────────────────┐│
  │USER_SPEAKING │ ─────────────┐         │  LLM_STREAMING   ││
  └──────────────┘             │         │  (streaming 3 候选)││
        │                      │         └──────────────────┘│
        ▼                      │            │            │   │
   append user turn            │          完成          被打断│
   (不出候选)                  │            │            │   │
        │                      │            ▼            ▼   │
        └──────────────────────┴──→ IDLE    显示候选   abort LLM
                                                          │  丢弃半截候选
                                                          │  context = 已完成 turns
                                       ┌──────────────────┘
                                       ▼
                                  OTHER_SPEAKING
                                  (新一轮对方)
```

**规则**：

1. **停顿阈值触发 LLM**：other 停说 ≥ 阈值（默认 1s，env `VAD_OTHER_PAUSE_MS` 可配置）→ append other turn → 触发 LLM streaming
2. **打断**：LLM streaming 中，VAD 检到新语音且 speaker=other → **abort 在途 LLM 请求**，**丢弃半截候选**（从 UI 移除），开始捕获新一轮 other
3. **多轮无用户**：一个 loop 里可能连续多个 other turn、user 全程不发言——每次 other 停顿 ≥ 阈值都触发一次 LLM，候选持续刷新
4. **完整对话进下一轮**：被打断后新一轮 LLM 收到的 context = **所有已完成的 ConversationTurn**（user STT + other STT）。被打断的半截候选**不进 context**（符合 §1.4"以 STT 为准，候选不算用户说了什么"）
5. **用户抢说取消 LLM**：other 停说、阈值倒计时中，若 user 开始说话 → **取消待触发的 LLM**，转去捕获 user turn，append 后等下一轮 other（不补触发 LLM，因为 LLM 只在 other turn 后触发）
6. **STT 失败**：自动重试 1 次（1s 退避）→ 仍失败 → `appendTurn({ text: '', sttFailed: true })`，UI 标红显示失败（**不可补字**，F03 转写不可编辑）→ 循环继续，**不杀会话**
7. **LLM 失败**：自动重试 1 次（1s 退避）→ 仍失败 → 候选区显示"出候选失败，重试"按钮，other turn 已入库不动 → 循环继续听下一轮，**不杀会话**
8. **不做**：fallback provider、熔断、多轮指数退避、离线缓存重放——MVP 过度

重试在 `packages/pipeline` 层做（catch 网络错误 + 重试 1 次 + 转用户可见状态）；`packages/llm` / `packages/stt` 的 client 内部不重试，保持简单。

**配置**：

VAD 停顿阈值与说话人判定阈值为**频繁调试参数**，在 playground 前端「调试参数」面板实时可调（`vad.updateConfig()` / `verifier.setThreshold()`），无需改 env 或重启会话；默认值在 `packages/pipeline` 的 `defaultConfig`：

- `VAD_OTHER_PAUSE_MS`（other 停说多久算"说完"→ 触发 LLM）：默认 1000
- `VAD_USER_PAUSE_MS`（user 停说多久算"说完"→ append turn）：默认与 other 同值
- 说话人判定 `threshold`：默认见 `packages/speaker`

便利店快节奏可能 700ms 更合适，会议场景可能 1.5s——先 1s 跑起来，playground 阶段按场景调。

#### SpeakerGate 选型结论

**任务边界**：MVP 是 **speaker verification**（先录 user 声纹，每句比对 → `user` / `other`），不是开放式 **diarization**（不知道几个人、还要切时间轴）。后者更难；前者对 PWA 更现实。

**默认：PWA 本地 verification**

| 方案 | 说明 | 体量 / 延迟 |
|------|------|-------------|
| Transformers.js + [`Xenova/wavlm-base-plus-sv`](https://huggingface.co/Xenova/wavlm-base-plus-sv) | 开源可跑；参考 [tinyscribe](https://github.com/jakewvincent/tinyscribe) | ~360MB，iPhone 首次下载痛 |
| [`@jaehyun-ko/speaker-verification`](https://github.com/jaehyun-ko/node-speaker-verification)（HF NeXt-TDNN ONNX） | enroll / embedding / cosine | mobile 数 MB；单次约几百 ms |
| [Picovoice Eagle Web](https://picovoice.ai/docs/quick-start/eagle-web/) | 商用 on-device，帧级打分 | 延迟低；需 access key |
| 自建 ECAPA / WeSpeaker → ONNX + `onnxruntime-web` | 最灵活 | 可量化控体积 |

落地注意：多线程 WASM 常要 **COOP/COEP**；推理放 **Web Worker**；iOS 优先小模型。

**云 API：verification 近乎空白**

- Azure Speaker Recognition、Amazon Connect Voice ID 等专用声纹云已退场或不可用。
- AssemblyAI / Deepgram 等主要是 **STT + diarization**（标 Speaker A/B），不是「已 enroll 的 user」；还要上云、流式标签可能事后改写，不适合当 F01/F02 主解。

**延迟**：Speaker 闸门本地通常几十～几百 ms / 句，可与 STT 并行；整条链路瓶颈仍是 STT + LLM，不是 speaker。

**与 STT 比难不难**

- 完整 diarization（多人、重叠）往往比 ASR 更脆。
- 你们这种 **1 人 enroll + 二分类** 比多语种 STT **更简单**（固定向量 + 阈值，不依赖语言）。
- 产品风险更大：ASR 错字可改；speaker 判错会乱触候选 / 漏出候选。**不**用 LLM 纠 speaker（成本翻倍且自身会错），**不**做事后纠错；误判对策 = 修 gate 本身（enrollment / 阈值 / 模型 / 安静 demo）。开发期测下游 pipeline 用 Playground 注入 mock speaker 标签，**不**在生产 pipeline 开 manual 分支。

**Demo 减误判**：安静环境、两人音色有差、enrollment 念够约 5–10 秒。

#### Enrollment 持久化

**方案**：enroll 一次，embedding 缓存 IndexedDB；提供手动重录按钮。每设备各 enroll 一次，**不**进服务端。

- embedding 是浮点向量（几百 KB），放 **IndexedDB**（非 localStorage——后者只适合小字符串且 5MB 上限、同步阻塞）
- MVP 无账号 = 无跨设备同步；换设备 = 换麦克风，声纹本来就该重录
- 将来加账号时可选同步到 Supabase（按 userId 存），但 `packages/speaker` 接口不变，只换底层存储

**`packages/speaker` 接口**：

```ts
enroll(audioStream, passphrase): Promise<Embedding>      // 念文案 → 算 embedding
loadEmbedding(): Promise<Embedding | null>               // 从 IndexedDB 读
saveEmbedding(e: Embedding): Promise<void>               // 写 IndexedDB
verify(audioChunk: ArrayBuffer, embedding: Embedding): Promise<{ speaker: 'user' | 'other', confidence: number }>
```

playground P0-c 调 `enroll` + `saveEmbedding`，P0-d 调 `loadEmbedding` + `verify`。生产 `apps/web` 开会话时先 `loadEmbedding()`，没有就跳 enrollment 页；设置页提供"重录声纹"按钮。

#### 会话持久化

**MVP 方案 B**：`ConversationTurn[]` 持久化到 IndexedDB（append-only log），无历史会话列表。理由：iOS Safari PWA 后台杀进程频繁，纯内存会话随时蒸发；MVP 不做"回看历史会话"，但需要崩溃/刷新恢复 + F09 可重新生成。

**`packages/conversation` 接口**：

```ts
appendTurn(turn: ConversationTurn): Promise<void>              // 同时写内存 + IndexedDB
loadActiveSession(): Promise<ConversationTurn[] | null>         // 启动时恢复进行中的会话
clearActiveSession(): Promise<void>                             // "结束会话"按钮调用
```

F09 结束回顾 = 对当前 `ConversationTurn[]` 调 LLM 生成 summary；turns 持久化后即使用户刷新也能重新生成。

**将来演进到 C**：加历史会话列表页 + 详情页；加账号后按 `userId` 把会话同步到 Supabase，实现跨设备。`packages/conversation` 接口不变，只换底层存储（IndexedDB → IndexedDB + Supabase 双写）。

### 2.5 提示词（Velin TSX）

`packages/prompts` 内按场景拆分：`reply-suggestions.tsx`、`session-summary.tsx` 等。

Velin 在 **Node / CI / eval** 中 `renderComponent`；浏览器运行时消费渲染后的字符串（或经 API route 渲染）。

### 2.6 提示词迭代（vieval）

`evals/` + 根 `vieval.config.ts`，矩阵维度示例：

- `level`: N5 | N3 | N1
- `scene`: convenience_store | general
- `model`: agent-mini | agent-large
- `historyDepth`: 0 | 2 | 5

重点测：用户上轮 STT 是否进入下轮建议、敬语/难度是否达标。

### 2.7 开发 Playground（功能验证，非 UI 组件库）

**背景**：整产品（`apps/web` + 完整页面流）在原型图 / UI 设计定稿前**跑不起来**，也不该为了调一个模块就把全应用拉起来。参考 [AIRI `dev:ui`](https://airi.moeru.ai/ui/)（Histoire 测 `stage-ui` 组件），我们要的是**另一层 playground**——测**能力模块**，不是测 shadcn 按钮长什么样。

| | AIRI `dev:ui` | 本项目 `apps/playground` |
|---|---|---|
| 目的 | UI 组件库隔离预览（Story / Variant） | 语音与对话 pipeline 功能验证 |
| 典型内容 | Input、Chat History、Level Meter… | VAD、STT、声纹 enrollment、说话人判定、LLM 出候选 |
| 界面要求 | 接近成品视觉 | **极简即可**：录音按钮、波形/日志、结果区 |
| 与主应用关系 | 与 `stage-web` 并行 | 与 `apps/web` 并行；**共用 `packages/*`** |

**原则**

1. **先小后大**：先把可独立验证的模块在 playground 里打通，再接到完整会话流。
2. **不等 UI 设计**：神奈子原型图定稿前，用 playground 推进 F01–F05、基础 LLM 回复等**后端 / pipeline 能力**；正式页面壳子后补。
3. **UI 组件库测试后置**：`packages/ui` 的 Storybook / Histoire 类工具**以后再做**；MVP 阶段不阻塞 pipeline 开发。
4. **Playground 可拆页**：每个模块一页或一个 tab，避免做成第二个完整产品。

**建议页面 / 模块（按开发顺序）**

| 阶段 | Playground 页 | 验证什么 | 对应需求 |
|------|---------------|----------|----------|
| P0-a | 麦克风 + VAD | 一句结束检测、切段预览 | F03 前置 |
| P0-b | STT | 录音 → 转写、可手改文本 | F03 |
| P0-c | 声纹 Enrollment | 读固定文案 → 存 embedding | F01 |
| P0-d | 说话人判定 | 新音频 → `user` \| `other` + 置信度 | F02 |
| P0-e | LLM 回复候选 | mock 对话历史 → 3 条候选（中/目标语/读音） | F04、F06、F07 |
| P0-f | 串联 Pipeline | VAD → speaker → STT → 按 speaker 分支（other 出候选 / user 只入库） | F02–F05 |
| 后续 | 组件库 Story | shadcn 封装稳定后再加，类似 AIRI `dev:ui` | F10 视觉层 |

**根脚本示例**

```json
{
  "scripts": {
    "dev:playground": "pnpm -F @lrc/playground dev",
    "dev:web": "pnpm -F @lrc/web dev"
  }
}
```

**与 `apps/web` 的分工**

- **`apps/playground`**：开发期工具；可注入 mock speaker 标签（绕过 speaker 模型测下游）、暴露原始 embedding、中间日志；**不**追求响应式 / PWA / 上架形态。
- **`apps/web`**：等产品 UI 定稿后，把已在 playground 验过的 `packages/pipeline`、`packages/speaker`、`packages/llm` **接进正式路由**；用户看到的才是 F10/F11 那套界面。

```text
packages/pipeline、speaker、llm、conversation  （真实实现）
        ↑                    ↑
 apps/playground          apps/web
 （极简 UI，先调通）    （原型定稿后的产品壳）
```

### 2.8 服务端与部署

**形态**：薄代理。不做业务编排，不存会话状态，只转发 LLM 与 STT 请求、藏 API key、透传 streaming 响应。

**框架**：Hono。轻量、平台无关（Node / Workers / Bun 都能跑），方便将来换 hosting。

**职责边界**：

| 路由 | 协议 | 作用 | 备注 |
|------|------|------|------|
| `POST /llm` | **SSE 流式** | 接收对话上下文 + prompt，转发 LLM provider，流式回 3 条候选（传原始 token） | key 在服务端环境变量 |
| `POST /stt` | 普通 POST | 接收 VAD 切好的音频片段，转发 STT provider，回 JSON 转写 | batch，与 speaker 判定并行 |

**流式协议选型**：

- **LLM 用 SSE**（Server-Sent Events）：单向服务端→客户端，Hono `streamSSE` 原生支持，是 LLM 流式的事实标准。代理透传 provider 的原始 token 流，浏览器用 `fetch` + `ReadableStream` 读，边收边增量解析结构化输出（3 候选的 JSON，用 partial-json 类库增量 parse）——第一个候选生成时用户就能开始读
- **STT 不流式**：本地 VAD 已切段，`/stt` 是 batch POST（音频 → JSON 转写）
- **不用 WebSocket**：流是单向的，打断是 abort 整个连接而非发消息，WebSocket 的双向能力用不上，纯属多付复杂度

**中断（对接 §2.4 状态机的"打断"分支）**：

- 浏览器 `AbortController.abort()` 断开 `/llm` 连接
- 代理在 Hono 里检测 `c.req.raw.signal.aborted` → abort 上游 provider 请求
- 半截候选丢弃（不进 context，符合 §1.4"以 STT 为准"）

```ts
app.post('/llm', streamSSE(async (c) => {
  const signal = c.req.raw.signal
  const stream = await llmClient.streamChat({ prompt, context, signal })
  for await (const token of stream) c.streamSSEMessage('token', token)
}))
```

**不做**：

- 不做 pipeline 编排（VAD / speaker / conversation store 全在浏览器）
- 不做账号 / 会话持久化（MVP 不上账号；将来加账号时再决定同步策略）
- 不做 SSR / 模板渲染

**STT 上行音频格式**：WAV，16kHz 单声道 PCM。

- 浏览器里音频本就是 PCM（VAD、speaker gate 都吃 PCM），WAV = 加 44 字节头，零依赖零编码
- 不用 MediaRecorder/WebM——MediaRecorder 是实时录流器，不能对任意 PCM 缓冲事后编码，切片复杂度会渗进 pipeline 状态机
- 16kHz mono 是语音采样标准，体积可控（3s ≈ 96KB），所有 STT provider 都认
- `packages/audio` 暴露 `encodeWav(pcm: Float32Array, sampleRate = 16000): ArrayBuffer`；`/stt` 收 WAV 转发 OpenRouter `/audio/transcriptions`（`input_audio.format: "wav"`）

**静态托管（`apps/web` 产物）**：MVP 由 `apps/api` 同进程托管，一个 Railway 服务、一个域、同源无 CORS。

- Hono 用 `serveStatic` 把 `apps/web/dist` 挂到根路径，API 路由挂 `/llm` `/stt`，PWA manifest / service worker 同源加载（iOS Safari 添加到主屏幕最稳）
- 开发期各自 dev server（Vite 5173 + Hono 8787），Vite proxy 把 `/llm` `/stt` 转发到 Hono，避免开发期 CORS
- 不构成锁定：`apps/web` 仍是独立 Vite 包，产物纯静态，将来要拆到 Cloudflare Pages 只需改 Hono 不 serve 静态 + 加 CORS

```ts
app.use('/llm', ...)
app.use('/stt', ...)
app.use('/*', serveStatic({ root: '../web/dist' }))
```

**部署**：Railway 常驻进程。选 Railway 而非 Vercel / Cloudflare Workers / VPS 的理由：

- streaming LLM 响应需要长连接，serverless 的执行时长 / 超时是隐患；常驻进程无此问题
- 单人 MVP 优先开发速度，git push 即部署 + 自动 TLS + 内置日志，省去 VPS 的 ops 折旧
- Hono 平台无关，将来要迁走 Railway 成本很低，不构成锁定

**与客户端的分工**：

```text
浏览器（Renderer + Web Worker）        Railway（常驻 Hono）
─────────────────────────              ──────────────────
VAD → SpeakerGate → STT 上行  ──POST /stt──→  转发 STT provider
                  ↓                       ←── 转写文本
            conversation.appendTurn
                  ↓
        if other:  ──POST /llm───→  转发 LLM provider
                                  ←── streaming 3 候选
```

**将来加账号时**：`ConversationTurn` 加可选 `userId`；auth 用 hosted Supabase 或 Railway Postgres add-on；代理层加一道 JWT 校验中间件。MVP 阶段不预留这些，只保证数据结构里 `userId` 是可选字段即可。

### 2.9 配置与环境变量

**原则**：MVP 阶段所有 provider 配置（key / base URL / model name）走 env，不落 DB。理由见 ADR 0001——单人单运营者，改配置频率低，Railway 改 env 重新部署 < 30s，DB + 加密 + 管理 UI 是过度设计。

**命名方案：前缀 + active 选择器**。加 provider 不改现有变量名，可同时配多组，一个变量切换当前使用的。

**MVP 默认：LLM 与 STT 共用 OpenRouter**——一个 key、一份账单。OpenRouter 同时聚合了 LLM（DeepSeek / Anthropic / …）和 STT（`openai/gpt-4o-transcribe`、`groq/whisper-large-v3-turbo`），所以 MVP 阶段一组 OpenRouter env 即可覆盖两条链路。STT 默认 `openai/gpt-4o-transcribe`（多语种准确率领先，日语为主场景），cost-fallback 切 `groq/whisper-large-v3-turbo`（便宜约 10×）。

```bash
# LLM 与 STT 共用 OpenRouter（MVP 默认）
LLM_ACTIVE=openrouter
LLM_OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
LLM_OPENROUTER_API_KEY=sk-or-...
LLM_OPENROUTER_MODEL=deepseek/deepseek-chat     # 或 anthropic/claude-...，随时切

STT_ACTIVE=openrouter
STT_OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
STT_OPENROUTER_API_KEY=sk-or-...                # 同一个 key
STT_OPENROUTER_MODEL=openai/gpt-4o-transcribe   # fallback: groq/whisper-large-v3-turbo

# 将来要直连某家（绕开 OpenRouter）时再加一组，无需改代码
# LLM_DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
# LLM_DEEPSEEK_API_KEY=sk-...
# LLM_DEEPSEEK_MODEL=deepseek-chat
# STT_OPENAI_BASE_URL=https://api.openai.com/v1
# STT_OPENAI_API_KEY=sk-...
# STT_OPENAI_MODEL=gpt-4o-transcribe
```

**与代码的接口（provider 无关，不写死 OpenRouter）**：

- `packages/llm` 暴露 `createLlmClient({ provider, baseUrl, apiKey, model })`，启动时按 `LLM_ACTIVE` 选一组 env 注入
- `packages/audio`（或新建 `packages/stt`）对 STT 同构：`createSttClient({ provider, baseUrl, apiKey, model })`
- `apps/api` 的 `/llm` `/stt` 路由接受可选 `provider` 字段做 per-request 覆盖（默认走 `LLM_ACTIVE` / `STT_ACTIVE`），将来按用户偏好路由就靠这个口子
- **OpenRouter 只是 `provider` 的一个取值，不是代码里的硬编码假设**。加新 provider = 加一个 adapter（实现 `createLlmClient` / `createSttClient` 的接口）+ 加一组 env，不动现有代码、不动其他 adapter。LLM 走 `/chat/completions`、STT 走 `/audio/transcriptions`，是 OpenRouter adapter 自己的事，不渗到工厂接口层

**分层（key 永不进 DB）**：

| 项 | MVP | 将来加账号 |
|----|-----|-----------|
| API key | env | 仍 env（master key，运营者持有） |
| base URL | env | env |
| model name | env | env 默认 + DB 存用户偏好（可选） |

用户不自带 key（已定"走我们中转"），所以 DB 只存"用哪个 provider/model"的选择，不存 key 本身。

**STT provider 选型结论**：本地 VAD 切段后 batch 发送（非连续 streaming），故 Deepgram 的 streaming 优势用不上；按"日语准确率 + 成本"选，默认 `openai/gpt-4o-transcribe`，`groq/whisper-large-v3-turbo` 作 cost-fallback。LLM 具体用哪个模型留到 playground 跑出候选质量再定，env 方案 B 让切换零成本。

**本地 STT（可选，低延迟）**：除云端 provider 外，`packages/stt` 另注册 `openai` provider——标准 OpenAI 兼容 multipart `/v1/audio/transcriptions`，默认指向本机 [`mlx-qwen3-asr`](https://github.com/moona3k/mlx-qwen3-asr)（`serve` 模式，Apple Silicon / MLX，Qwen3-ASR-1.7B，日语 FLEURS 3.6% 错误率）。该服务是本机独立进程，**不纳入本仓库**。**仍经 `apps/api` 的 `/stt` 代理转发**（不浏览器直连）：浏览器只发 `/stt?provider=openai`，base URL / key / model 全留在服务端 env，单一入口、key 不出服务端。`apps/api` 与 `mlx-qwen3-asr` 须同机（本地 dev 场景）；部署到 Railway 时用云端 provider。云端仍是默认。详见 [ADR 0002](./adr/0002-local-stt-mlx-qwen3-asr.md)。

```bash
# 本地 Qwen3-ASR（仅 Apple Silicon，与 apps/api 同机）
pip install "mlx-qwen3-asr[serve]"
mlx-qwen3-asr serve --api-key $(openssl rand -hex 16)   # localhost:8765
# 服务端 .env：
STT_OPENAI_BASE_URL=http://localhost:8765/v1
STT_OPENAI_API_KEY=本地 serve 启动时生成的 key
STT_OPENAI_MODEL=Qwen/Qwen3-ASR-1.7B   # 想更快切 Qwen/Qwen3-ASR-0.6B
# 浏览器：POST /stt?provider=openai
```

---

## 3. 平台与 Electron

### 3.1 需求拆分

| 能力 | Web / PWA | Electron（P1） |
|------|-----------|----------------|
| iPhone 麦克风 | ✅ | — |
| Mac 浏览器麦克风 | ✅ | — |
| Mac **系统声音** | ❌ | ✅ ScreenCaptureKit 等 |
| 一套 UI 代码 | ✅ `packages/*` | ✅ 同一批 `packages/*` |

### 3.2 结论：Web 优先 + 按需 Electron

1. **移动端只需麦克风** → **PWA 足够**（Safari `getUserMedia` + 添加到主屏幕）。
2. **桌面浏览器也要做** → `apps/web` 响应式布局，Mac 打开 URL 即可演示。
3. **系统音频仅 P1** → `apps/desktop` Electron 薄壳；**与 web 共用 packages**，不是嵌 web 的静态 dist 壳（对齐 AIRI tamagotchi 模式）。

### 3.3 为何选 Electron（P1 时）

- 路路有 Electron 经验；[AIRI `stage-tamagotchi`](https://github.com/moeru-ai/airi)、[DeepChat](https://github.com/thinkinaixyz/deepchat) 均为先例。
- Mac 系统音需在主进程或 native 模块处理；MVP 可**先不做壳**，麦克风演示不阻塞。

```text
Phase 0（MVP）：apps/web + PWA
Phase 1（加分）：apps/desktop（Electron，共用 packages）
```

### 3.4 三端交付

| 端 | 工程 | 用户怎么打开 |
|----|------|--------------|
| iPhone | `apps/web` + PWA | Safari → 添加到主屏幕 |
| Mac 浏览器 | `apps/web` | 访问 URL |
| Mac 系统音 | `apps/desktop` | 安装 .dmg（P1） |

---

## 4. UI 与开发顺序

### 4.1 产品 UI（等原型定稿）

- 页面与组件在 **`packages/pages` + `packages/ui`**，`apps/web` 只负责挂载。
- Tailwind breakpoint：移动单列 + 底部操作条；桌面时间轴与候选并排。
- shadcn 初始化在 `packages/ui`（或 `apps/web` 的 `components.json` 指向 ui 包）。
- **依赖神奈子原型图**：会话页、声纹录制页、回顾页等布局与交互以她的稿为准；定稿前不在 `apps/web` 里硬猜 UI。

### 4.2 推荐开发顺序

**阶段 A — Playground 打通核心能力（不等完整 UI）**

1. 搭 `apps/playground` + `packages/pipeline` 骨架  
2. VAD → STT（F03）  
3. 声纹 enrollment + 说话人判定（F01、F02）  
4. mock 对话流 + LLM 出 3 条候选（F04、F06、F07）  
5. 串联：other 出候选 / user 只写入（F05）  

**阶段 B — 产品壳（原型定稿后）**

6. 按原型实现 `packages/pages` + `packages/ui`  
7. `apps/web` 接入已验过的 packages；桌面浏览器调通完整流程  
8. 收窄 viewport / 真机 Safari 验 PWA（F10、F11）  
9. 结束回顾（F09）  

**阶段 C — 加分与工具**

10. P1：`apps/desktop`（系统音）  
11. 可选：`packages/ui` 组件 Storybook（类 AIRI `dev:ui`），与 playground 分工明确  

**要点**：整项目一时跑不起来是预期状态；**先在 playground 把「听 → 认人 → 转写 → AI 答」最小闭环做实**，UI 抛光与三端交付叠在后面。

---

## 5. 风险与对策

| 风险 | 对策 |
|------|------|
| 双人同麦 / 短句 / 音色接近导致 speaker 误判 | 本地 verification + 阈值调参；安静 demo；enrollment 念够 5–10 秒；必要时换 NeXt-TDNN mobile / Eagle 等更稳模型；测 user↔other 混淆率。**不**用 LLM 纠 speaker（成本翻倍且自身会错）；**不**做事后纠错；manual 标注仅活在 Playground（注入 mock 标签测下游），不进生产 env |
| PWA 本地模型体积大 / iOS 慢 | 优先 NeXt-TDNN mobile 或 Eagle；Worker + 缓存；避免默认拉 360MB WavLM |
| PWA iOS 后台杀进程 | UI 提示保持前台；会话可导出 |
| 神奈子要独立 Mac 程序感 | P1 Electron 安装包；MVP 浏览器 + PWA 可演示核心 |

---

## 6. 待与神奈子确认

1. MVP 是否接受 **浏览器 + PWA**，Electron 仅 P1（系统音）？  
2. 候选不可编辑，改为「换一批」是否 OK？  
3. 演示是否固定「便利店 3 轮对话」脚本？  

---

## 相关

- [产品想法原文](./2026-07-16-live-reply-coach-language-assist.md)
- [AIRI 插件 UI 范围](../notes/2026-07-16-airi-plugin-ui.md)
- 参考仓库：[airi](https://github.com/moeru-ai/airi) · [webai-realtime-voice-chat](https://github.com/proj-airi/webai-example-realtime-voice-chat) · [velin](https://github.com/moeru-ai/velin) · [vieval](https://github.com/vieval-dev/vieval) · [deepchat](https://github.com/thinkinaixyz/deepchat)
- Speaker 本地：[tinyscribe](https://github.com/jakewvincent/tinyscribe) · [speaker-verification](https://github.com/jaehyun-ko/node-speaker-verification) · [Eagle Web](https://picovoice.ai/docs/quick-start/eagle-web/) · [wavlm-base-plus-sv](https://huggingface.co/Xenova/wavlm-base-plus-sv)
