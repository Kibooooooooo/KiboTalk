# 客户端编排 + 薄 Hono 代理

会话编排（VAD / 说话人判定 / STT 上行 / conversation store）全部跑在浏览器，服务端只做一个薄 Hono 代理转发 LLM 与 STT 请求、藏 API key、透传 streaming。部署在 Railway 常驻进程上。MVP 不做账号，将来加账号时用 hosted Supabase。

## 为何不把编排放服务端

DeepChat 的会话编排住在其 Electron Main 进程（Node.js）里——因为它本来就是桌面应用，本地有常驻进程可以藏 key、跑 Tape。我们是 PWA + 浏览器，没有常驻本地进程；如果把编排搬到云端，每段音频都要上行、每个 turn 都要往返，延迟和带宽成本没有换来任何好处（pipeline 本来就是 Web Worker / WASM 在客户端跑的）。所以编排留在浏览器，云端只承担"藏 key"这一个不可替代的职责。

## 为何不用 Next.js + Vercel

Next.js 的核心价值（SSR / RSC / 文件路由 / 服务端数据获取）对这款单页会话流 PWA 没有用武之地——没有 SEO 需求、没有静态内容、没有服务端渲染需求。客户端重活（VAD / speaker / WASM / Web Worker / PWA / Electron 薄壳）Next.js 帮不上忙。服务端只是两路由代理，用 Next.js 的 API routes 是杀鸡用牛刀，反而被其运行时模型绑死。Vite + React（沿用既有 spec）+ 独立 Hono 薄 server，客户端形态干净、服务端薄到可随时换 hosting。

## 为何 Railway 而非 Vercel / Cloudflare Workers / VPS

- Vercel / Cloudflare Workers 是 serverless，streaming 长响应会撞执行时长与超时；Railway 是常驻进程，无此问题
- VPS 成本更低但要自己背 ops（TLS / 部署 / 日志 / 安全更新），与"最快开发"的优先级冲突
- Hono 平台无关，将来要迁走 Railway 成本极低，不构成锁定

## 后果

- 客户端必须自己处理 pipeline 失败重试 / 断网恢复（服务端无状态）
- API key 永远不出服务端；客户端只看到我们自己的代理接口
- 加账号时需要新增 auth 中间件 + 给 `ConversationTurn` 加可选 `userId`，不影响现有编排
