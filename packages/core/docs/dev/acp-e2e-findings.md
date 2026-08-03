# ACP 模块端到端测试问题汇总（open-insight 仓库）

> 测试对象：`packages/core/src/acp/` 全模块（`http.ts` / `service.ts` / `stream.ts` / `prompt.ts` / `error.ts`）
> 被测环境：`ghcr.io/openinsightdev/acp-agent:0.0.2` + `codex-acp@1.1.9` + DeepSeek（`deepseek-v4-flash`，`https://api.deepseek.com/v1`）
> 测试入口：`packages/core/e2e/acp.e2e.test.ts`（需先按文件头注释启动容器）
> 结论：**本模块无法直接对接已发布的 acp-agent 镜像**。流转换、prompt 转换、轨迹、会话隔离在真实 agent 下验证正常，但存在 2 个代码级缺口和 1 个文档级缺口。acp-agent 自身的问题（Deno 依赖年龄策略、镜像平台、可观测性等）见 `packages/acp-agent/docs/e2e-findings.md`。

---

## 1. 传输层缺口：`openHttpStream` 依赖不存在的字节流帧格式（P0）

**现象**：模块唯一的 `layer()` 入口对已发布镜像完全不可用。`http.ts` 的 `openHttpStream` 使用 `Undici.H2CClient` 发起 HTTP/2 prior-knowledge 全双工字节流请求（`Content-Type: application/octet-stream` + NDJSON 帧），但 `ghcr.io/openinsightdev/acp-agent:0.0.2` 的 `/acp` 端点只接受 JSON 消息，字节流请求被拒：

```
$ curl --http2-prior-knowledge -X POST http://127.0.0.1:8010/acp \
    -H "content-type: application/octet-stream" -d '...'
2 415        # Unsupported Media Type（Content-Type must be application/json）
```

`openHttpStream` 收到 415 后按预期抛 `AcpHttpTransportError`（operation `response`，status 415），但任何调用方都无法真正连上 agent。

**根因（2026-08 复测修正）**：此前把缺口定位为“h2c 全双工模式未发布”，**该判断是错的**。复测确认：

- **h2c prior-knowledge 传输本身可用**——415 是应用层返回，说明 HTTP/2 链路（`H2CClient` 的连接、帧、流）全部走通；open-insight core 缺的不是 h2c，而是**字节流消息框架**：服务端 `handle_post` 只接受 `Content-Type: application/json`（单个 JSON-RPC 消息或 batch），`application/octet-stream`（NDJSON 字节流）一律 415；
- `Upgrade: h2c` 头协商方式也不支持（返回 200 而非 101），仅 prior-knowledge 一种 h2c 可用；
- 服务端实际暴露的传输是 **Streamable HTTP**（POST JSON + SSE GET）与 **WebSocket**，两者均验证可用。SDK 自带的 `createHttpStream`（`@agentclientprotocol/sdk/experimental/http-client`，即 `http.ts` 注释里提到的 “POST + SSE Streamable HTTP transport”）与已发布镜像语义完全对齐——本模块没有使用它，而是针对一个服务端不存在的帧格式开发，且没有兜底。

**影响**：`Acp.layer(url, ...)` 无法连接任何已发布版本的 acp-agent。当前唯一能跑通真实 agent 的路径是绕过 `layer()`，直接用 SDK 的 `createWebSocketStream`（`@agentclientprotocol/sdk/experimental/ws-client`）构造 `AcpStream` 后调用 `makeProvider`——e2e 测试即采用此方式。

**建议（下一步修复）**：

- 短期：`http.ts` 对接服务端真实存在的传输，两种按 URL scheme 并存分流——
  - **Streamable HTTP**：改用 SDK `createHttpStream`（POST `application/json` + GET SSE），与已发布镜像语义精确匹配，`http:` URL 走此路径；
  - **WebSocket**：补充 `openWebSocketStream`，`ws:` URL 走此路径（e2e 已验证可用）；
- `openHttpStream` 的 octet-stream 帧格式在服务端支持之前不可用，不应再作为 `layer()` 的默认路径；
- 客户端必须遵守镜像的传输面约束（见 §5 支持矩阵：HTTP 只发 JSON、WS 只发文本帧、不能依赖 WS 优雅关闭等）；
- e2e 测试已固定该缺口（415 + `AcpHttpTransportError`），防止未来无感知回归。

## 2. 鉴权缺口：`makeProvider` 从不调用 `agent/authenticate`（P0）

**现象**：真实 codex-acp 在会话创建阶段强制鉴权。模块完成 `initialize` 后直接 `buildSession().start()`，被 agent 拒绝：

```
RequestError: Authentication required   (code -32000)
Caused by: StreamError: Agent response stream failed: Authentication required
```

**根因**：ACP 协议中 `initialize` 响应携带 `authMethods`（codex-acp 返回 `api-key` / `chat-gpt` / `gateway`），客户端需在建会话前调用 `agent/authenticate`。`service.ts` 的 `makeProvider` 只做 initialize + session，没有任何鉴权逻辑，`Options` 也没有 `auth` 配置项。单元测试用 fake agent 掩盖了这一点——fake 的 `onRequest(methods.agent.authenticate, ...)` 只是"允许"该方法存在，客户端从未真正调用。

**影响**：模块对任何需要鉴权的真实 agent（当前主流 ACP agent 均如此）都无法建立会话。e2e 中通过 agent 侧环境变量 `DEFAULT_AUTH_REQUEST={"methodId":"api-key"}` 绕过（codex-acp 内部代为完成 authenticate）。

**建议**：

- `Options` 增加鉴权配置（如 `auth?: { methodId; credentials }`），`makeProvider` 在 initialize 后、建会话前执行 `agent/authenticate`；
- 鉴权失败/被要求交互时应给出语义明确的 `Acp.Error`（当前 `Authentication required` 被包装成通用 `StreamError`，无法区分是网络错误还是鉴权错误）；
- 单元测试补充"agent 要求鉴权但客户端未提供"的失败用例。

## 3. snapshot 指令不含任何运行时配置（P1）

**现象**：`snapshotExtension` 只生成三条安装命令 + 一条 serve 命令：

```
acp-agent install-env --yes
acp-agent install codex-acp
acp-agent serve codex-acp --host 0.0.0.0 --port 7689 --path /acp --yolo
```

按此部署的 agent 必然失败：deno 依赖年龄策略、缺少鉴权、缺少模型 provider 配置都会在首次连接时把 agent 打挂或拒绝会话（详见 acp-agent 文档 §1–§2 与本文档 §2）。e2e 实测需要额外注入 `deno.json`、`DEFAULT_AUTH_REQUEST`、`CODEX_CONFIG` 三个配置才能跑通。

**建议**：`snapshotExtension` 应支持注入 serve 环境的配置（至少支持自定义 env / 配置文件），或把部署要求写进模块文档；当前生成的指令对真实环境不具备可执行性。

## 4. 单元测试盲区（P2）

**现象**：`service.test.ts` 的 fake agent 是"理想化"的：initialize 直接成功、不要求鉴权、prompt 立即回包。以下真实行为均未被覆盖：

- 鉴权强制（§2）——fake 中 authenticate handler 从未被调用，测试无法发现客户端缺失 authenticate 调用；
- agent 进程启动失败（`agent closed before initialize response`）时的错误路径；
- 传输层与真实镜像的握手差异（§1）。

**建议**：保留 `packages/core/e2e/` 套件（已补充真实链路），并在单测中补充鉴权失败、启动失败的用例。

---

## 5. 已发布镜像传输面支持矩阵（2026-08 复测）

复测对象：`ghcr.io/openinsightdev/acp-agent:0.0.2` 的 `/acp` 端点（Rust `agent-client-protocol-http@2.0.0`）。下表是客户端实现（尤其是下一步修复）必须遵守的边界。

### ✅ 支持的

- **h2c prior-knowledge**：HTTP/2 连接可用（`H2CClient` 能建立连接并收到应用层响应）；
- **POST `application/json`**：单个 JSON-RPC 消息或 batch；首次 `initialize` 返回 `Acp-Connection-Id` 头，后续消息必须携带；
- **GET SSE**：带 `Accept: text/event-stream` + `Acp-Connection-Id` 订阅服务端消息流（15s keep-alive）；
- **DELETE**：按 `Acp-Connection-Id` 关闭连接；
- **WebSocket 文本帧**：全链路验证可用（e2e 用例①）；
- **CORS 可配置**：`--cors-allow-origins` / `--cors-allow-any` 开启后 OPTIONS 预检正常。

### ❌ 不支持的（复测确认）

| #   | 行为                                                                | 现象                                                                                                                           | 服务端出处                                                 |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | 非 JSON Content-Type（含 `application/octet-stream` NDJSON 字节流） | `415 Unsupported Media Type`，只收 `application/json`                                                                          | `agent-client-protocol-http` `http_server.rs::handle_post` |
| 2   | `GET /acp` 不带 `Accept: text/event-stream`                         | `406 Not Acceptable`                                                                                                           | `http_server.rs::handle_get`                               |
| 3   | WS 二进制帧                                                         | 静默忽略并 warn `"Ignoring binary message (ACP uses text)"`，无错误回包——客户端发二进制帧会被无声丢弃                          | `websocket_server.rs::run_ws_message_loop`                 |
| 4   | WS 关闭协商                                                         | 收到 Close 帧直接断开、**不回 close 帧**，客户端观察到 1006（abnormal closure）——客户端不能依赖优雅关闭，应主动先关或容忍 1006 | `websocket_server.rs`                                      |
| 5   | CORS 默认策略                                                       | 默认 `CorsOptions::disabled()`：OPTIONS 预检 → 405；带 `Origin` 的 WS 握手 → 403                                               | `serve.rs::ServeOptions::default`                          |
| 6   | `Upgrade: h2c` 头协商                                               | 返回 200 而非 101，仅 prior-knowledge 有效                                                                                     | 实测（hyper/axum 未启用 h2c upgrade 路径）                 |

**对下一步修复的含义**：

- 帧格式：HTTP 侧只能发 JSON（单条或 batch），响应走 SSE；NDJSON 字节流需要服务端先支持；
- WS 侧只能发文本帧，且关闭握手不可靠（1006）；
- 浏览器直连受限：CORS 默认关闭，需服务端 `--cors-allow-any`（或限定 origin）或由 open-insight 侧代理；
- 与 `packages/acp-agent/docs/e2e-findings.md` §5 互为印证：服务端只有 Streamable HTTP + WebSocket 两种传输。

## 已确认正常的部分

- **流转换**（`stream.ts`）：真实 codex-acp 的 `agent_message_chunk` → `text-start/delta/end`、`agent_thought_chunk` → `reasoning-start/delta/end`、`usage_update` → `finish`，与 AGENTS.md 的映射表一致（deepseek 实测输出 reasoning + text 两类 chunk）。
- **轨迹与多轮会话**：`trajectory()` 正确累积 user/assistant 历史；同一 session 第二轮正常延续（历史长度 2 → 4）。
- **prompt 转换**（`prompt.ts`）：`Prompt.make(...)` → ACP `prompt` 数组在真实 agent 上被接受。
- **错误类型化**：字节流帧格式被拒的 415 以 `AcpHttpTransportError`（operation `response`）正确上抛。
- **yolo 模式**：`serve --yolo` 正常工作，未触发权限请求。

## 复现步骤

```sh
# 启动容器（完整命令与各配置项说明见 acp-agent 文档末尾）
cd packages/core
./node_modules/.bin/vitest run --config e2e/vitest.e2e.config.ts
```

两个用例：① WebSocket 全链路真实对话（含两轮会话 + 轨迹断言）；② 字节流帧格式缺口固定（415 `AcpHttpTransportError`）。
