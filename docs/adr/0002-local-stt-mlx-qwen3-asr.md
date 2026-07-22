# 本地 STT = 外部 mlx-qwen3-asr（OpenAI 兼容）

STT 增加一条本地低延迟路径：浏览器直连一个外部 Python 服务 `mlx-qwen3-asr`（`serve` 模式），它暴露标准 OpenAI `/v1/audio/transcriptions`（multipart）。该服务不纳入本仓库，作为独立进程在本机运行。

## 为何要本地 STT

云端 STT（OpenRouter → gpt-4o-transcribe）质量好但每段音频都要上行往返，延迟受网络主导。实时回复教练对 STT 延迟敏感，本地推理可消除网络段。Apple Silicon 上 MLX 原生跑 Qwen3-ASR-1.7B，短段推理亚秒级，日语 FLEURS 3.6% 错误率，优于 Whisper-large-v3。

## 为何选 Qwen3-ASR 而非 Whisper / Moonshine / Distil-Whisper

- Whisper（2022/2023）多语种可用但偏老；Moonshine、Distil-Whisper 更快但**英语 only**，不支持日语，直接出局
- Qwen3-ASR（2025）开源 ASR SOTA，52 语种含日语，对标 GPT-4o-Transcribe
- `moona3k/mlx-qwen3-asr` 是 Qwen3-ASR 在 Apple Silicon 上的 MLX 逐层重写（非 wrapper），Metal GPU，自带 OpenAI 兼容 `serve`，Apache-2.0，无需自己写 server

## 为何不纳入本仓库 / 不自写 Python 服务

- 本仓库是 pnpm Node monorepo，Python 服务不属于此 workspace
- `mlx-qwen3-asr serve` 已是 OpenAI 兼容 server，无需造轮子；只需 `pip install "mlx-qwen3-asr[serve]"` + 一行 `serve` 启动

## 为何浏览器直连本地（不经 apps/api 代理）

本地服务无 key 顾虑（key 是用户本机自生成、不离开本机），代理它反而多一跳。与 ADR-0001 一致：proxy 只承担"藏云端 key"这一不可替代职责；本地无 key 时编排留在浏览器。云端 provider 仍走 `apps/api` 代理藏 key。

## 接线

- `packages/stt`：新增通用 OpenAI 兼容 multipart 适配器，注册为 `openai` provider，默认模型 `Qwen/Qwen3-ASR-1.7B`。同一适配器也适用于 vLLM / Groq / 真 OpenAI
- `.env.example`：`STT_ACTIVE=openai` + `STT_OPENAI_BASE_URL` / `STT_OPENAI_API_KEY` / `STT_OPENAI_MODEL` 一组（云端代理路径仍由 `apps/api` 用）
- playground STT 面板：`cloud` / `local` 开关；`local` 时浏览器直连 `http://localhost:8765/v1`，可在面板内填 base URL / key / 模型

## 后果

- 本地 STT 仅 Apple Silicon 可用（MLX/Metal）；非 Mac 用户只能用云端 provider
- 本地服务是用户自行安装运行的外部依赖，本仓库不保证其可用性；playground 在 local 模式下连不上时显示原始错误
- 两个 provider 共用 `SttClient` 接口，pipeline 不感知差异
