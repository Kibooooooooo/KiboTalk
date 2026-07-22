# 本地 STT = 外部 mlx-qwen3-asr（OpenAI 兼容，经代理）

STT 增加一条本地低延迟路径：经 `apps/api` 的 `/stt` 代理转发到一个外部 Python 服务 `mlx-qwen3-asr`（`serve` 模式），它暴露标准 OpenAI `/v1/audio/transcriptions`（multipart）。该服务不纳入本仓库，作为独立进程在本机运行。

## 为何要本地 STT

云端 STT（OpenRouter → gpt-4o-transcribe）质量好但每段音频都要上行往返，延迟受网络主导。实时回复教练对 STT 延迟敏感，本地推理可消除网络段。Apple Silicon 上 MLX 原生跑 Qwen3-ASR-1.7B，短段推理亚秒级，日语 FLEURS 3.6% 错误率，优于 Whisper-large-v3。

## 为何选 Qwen3-ASR 而非 Whisper / Moonshine / Distil-Whisper

- Whisper（2022/2023）多语种可用但偏老；Moonshine、Distil-Whisper 更快但**英语 only**，不支持日语，直接出局
- Qwen3-ASR（2025）开源 ASR SOTA，52 语种含日语，对标 GPT-4o-Transcribe
- `moona3k/mlx-qwen3-asr` 是 Qwen3-ASR 在 Apple Silicon 上的 MLX 逐层重写（非 wrapper），Metal GPU，自带 OpenAI 兼容 `serve`，Apache-2.0，无需自己写 server

## 为何不纳入本仓库 / 不自写 Python 服务

- 本仓库是 pnpm Node monorepo，Python 服务不属于此 workspace
- `mlx-qwen3-asr serve` 已是 OpenAI 兼容 server，无需造轮子；只需 `pip install "mlx-qwen3-asr[serve]"` + 一行 `serve` 启动

## 为何本地也走 apps/api 代理（不浏览器直连）

- **单一入口**：浏览器永远只打 `/stt`，云端/本地差异由服务端 env 决定，前端代码路径统一
- **key 仍不出服务端**：本地 `STT_OPENAI_*`（base URL / key / model）写在服务端 `.env`，浏览器只传 `?provider=openai` 选 provider，不接触 key
- 与 spec §2.9「/stt 接受可选 provider 字段做 per-request 覆盖」一致
- 代价：`apps/api` 与 `mlx-qwen3-asr` 必须同机部署（代理用 `localhost:8765` 访问本地服务），故本地 STT 仅在本地 dev（两者同机）场景生效；部署到 Railway 时用云端 provider

## 接线

- `packages/stt`：通用 OpenAI 兼容 multipart 适配器，注册为 `openai` provider，默认模型 `Qwen/Qwen3-ASR-1.7B`。同一适配器也适用于 vLLM / Groq / 真 OpenAI
- `sttConfigFromEnv(env, providerOverride?)`：可选 per-request provider 覆盖，base URL / key / model 仍从服务端 env 读
- `apps/api` `/stt`：读 `?provider=` query 传给 `sttConfigFromEnv`；不传则用 `STT_ACTIVE`
- `.env.example`：`STT_OPENAI_BASE_URL` / `STT_OPENAI_API_KEY` / `STT_OPENAI_MODEL` 一组（服务端持有）
- playground STT 面板：`云端代理` / `本地 Qwen3-ASR` 开关；`local` 时发 `/stt?provider=openai`，不填 base/key/模型

## 后果

- 本地 STT 仅 Apple Silicon 可用（MLX/Metal）；非 Mac 用户只能用云端 provider
- 本地 STT 仅在 `apps/api` 与 `mlx-qwen3-asr` 同机时生效（本地 dev 场景）
- 本地服务是用户自行安装运行的外部依赖，本仓库不保证其可用性；连不上时代理返回原始错误
- 两个 provider 共用 `SttClient` 接口，pipeline 不感知差异
