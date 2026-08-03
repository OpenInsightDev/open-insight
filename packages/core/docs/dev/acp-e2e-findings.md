# ACP 模块端到端测试问题汇总（open-insight 仓库）

> 测试对象：`packages/core/src/acp/` 全模块（`http.ts` / `service.ts` / `stream.ts` / `prompt.ts` / `error.ts`）
> 初测环境：`ghcr.io/openinsightdev/acp-agent:0.0.2` + `codex-acp@1.1.9` + DeepSeek（`deepseek-v4-flash`，`https://api.deepseek.com/v1`）
> 修复验证环境：本地构建 `acp-agent@c467d25`（arm64）+ `codex-acp@1.1.9` + DeepSeek
> 测试入口：`packages/core/e2e/acp.e2e.test.ts`（需先按文件头注释启动容器）
> 当前结论：文中 2 个 P0 代码缺口、1 个 P1 部署缺口和相应测试盲区均已修复。`Acp.layer()` 已在本地最新 acp-agent 镜像上通过 Streamable HTTP 与 WebSocket 真实 E2E；初测现象保留为问题背景。

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

**修复**：`openHttpStream` 已改用 SDK `createHttpStream`（POST JSON + GET SSE + DELETE）；新增 `openWebSocketStream`，`openStream` 和 `Acp.layer()` 按 `http(s)` / `ws(s)` URL scheme 分流并透传完整 SDK transport 选项。服务端不支持的 octet-stream 实现已删除。单测覆盖 HTTP JSON/SSE/DELETE、headers、错误类型和 WebSocket 文本帧/关闭；真实 E2E 同时覆盖两个 `layer()` 入口。

## 2. 鉴权缺口：`makeProvider` 从不调用 `agent/authenticate`（P0）

**现象**：真实 codex-acp 在会话创建阶段强制鉴权。模块完成 `initialize` 后直接 `buildSession().start()`，被 agent 拒绝：

```
RequestError: Authentication required   (code -32000)
Caused by: StreamError: Agent response stream failed: Authentication required
```

**根因**：ACP 协议中 `initialize` 响应携带 `authMethods`（codex-acp 返回 `api-key` / `chat-gpt` / `gateway`），客户端需在建会话前调用 `agent/authenticate`。`service.ts` 的 `makeProvider` 只做 initialize + session，没有任何鉴权逻辑，`Options` 也没有 `auth` 配置项。单元测试用 fake agent 掩盖了这一点——fake 的 `onRequest(methods.agent.authenticate, ...)` 只是"允许"该方法存在，客户端从未真正调用。

**影响**：模块对任何需要鉴权的真实 agent（当前主流 ACP agent 均如此）都无法建立会话。e2e 中通过 agent 侧环境变量 `DEFAULT_AUTH_REQUEST={"methodId":"api-key"}` 绕过（codex-acp 内部代为完成 authenticate）。

**修复**：`Options.auth` 接受稳定 ACP SDK 的 `AuthenticateRequest`（当前协议字段为 `methodId`）。显式配置 auth 时，`makeProvider` 会在 initialize 之后、session/new 之前验证 agent 公布的方法并调用 `agent/authenticate`；未配置时不会把“公布可用鉴权方式”误判为“当前连接必须鉴权”，而是在 session/new 真正返回 `auth_required` 时将结构化 `AcpAuthenticationError` 保留在 `Agent.Error` cause 链中。方法不支持和远端拒绝也映射为 `AcpAuthenticationError`。单测覆盖可匿名 session、请求参数与顺序、真实 auth_required、方法不支持和远端拒绝。真实 E2E 不再注入 `DEFAULT_AUTH_REQUEST`，因此会实际经过客户端鉴权。

## 3. snapshot 指令不含任何运行时配置（P1）

**现象**：`snapshotExtension` 只生成三条安装命令 + 一条 serve 命令：

```
acp-agent install-env --yes
acp-agent install codex-acp
acp-agent serve codex-acp --host 0.0.0.0 --port 7689 --path /acp --yolo
```

初测时按此部署的 agent 必然失败：deno 依赖年龄策略、缺少鉴权、缺少模型 provider 配置都会在首次连接时把 agent 打挂或拒绝会话。旧 `v0.0.2` 镜像的 e2e 需要额外注入 `deno.json`、`DEFAULT_AUTH_REQUEST`、`CODEX_CONFIG` 三个配置才能跑通。

**修复**：`Acp.Options` 现在提供 `serveEnv`。`snapshotExtension` 会将其编码为紧邻 `acp-agent serve` 命令的 Snapshot `ENV` 指令，供 serve 进程及其启动的 agent 继承。真实 codex-acp 部署可通过它传入 `DEFAULT_AUTH_REQUEST`、`CODEX_CONFIG` 等运行时配置；因 Snapshot `ENV` 会写入派生镜像，敏感凭据只能用于受保护的镜像。本地验证使用的 acp-agent `main@c467d25` 安装流程已经传递 `--minimum-dependency-age 0`，因此不再需要旧 `v0.0.2` 镜像部署中的 `deno.json` 绕过配置。

## 4. 单元测试盲区（P2）

**现象**：`service.test.ts` 的 fake agent 是"理想化"的：initialize 直接成功、不要求鉴权、prompt 立即回包。以下真实行为均未被覆盖：

- 鉴权强制（§2）——fake 中 authenticate handler 从未被调用，测试无法发现客户端缺失 authenticate 调用；
- agent 进程启动失败（`agent closed before initialize response`）时的错误路径；
- 传输层与真实镜像的握手差异（§1）。

**修复**：`service.test.ts` 已覆盖强制鉴权、调用顺序与拒绝路径；`http.test.ts` 覆盖两种已发布传输。`packages/core/e2e/` 直接使用最新本地镜像验证 `Acp.layer()` 的 HTTP/WS 链路、鉴权、真实模型流、多轮会话和轨迹。agent 进程启动失败、stderr 转发和 `/readyz` 由最新版 acp-agent 的 Rust 网络测试覆盖。

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

**客户端实现约束**：

- 帧格式：HTTP 侧只能发 JSON（单条或 batch），响应走 SSE；NDJSON 字节流需要服务端先支持；
- WS 侧只能发文本帧，且关闭握手不可靠（1006）；
- 浏览器直连受限：CORS 默认关闭，需服务端 `--cors-allow-any`（或限定 origin）或由 open-insight 侧代理；
- 与本地验证的 acp-agent 源码一致：服务端只有 Streamable HTTP + WebSocket 两种传输。

## 已确认正常的部分

- **流转换**（`stream.ts`）：真实 codex-acp 的 `agent_message_chunk` → `text-start/delta/end`、`agent_thought_chunk` → `reasoning-start/delta/end`、`usage_update` → `finish`，与 AGENTS.md 的映射表一致（deepseek 实测输出 reasoning + text 两类 chunk）。
- **轨迹与多轮会话**：`trajectory()` 正确累积 user/assistant 历史；同一 session 第二轮正常延续（历史长度 2 → 4）。
- **prompt 转换**（`prompt.ts`）：`Prompt.make(...)` → ACP `prompt` 数组在真实 agent 上被接受。
- **错误类型化**：字节流帧格式被拒的 415 以 `AcpHttpTransportError`（operation `response`）正确上抛。
- **yolo 模式**：`serve --yolo` 正常工作，未触发权限请求。

## 复现步骤

```sh
# 先按 e2e 文件头注释构建并启动本地最新 acp-agent 镜像
cd packages/core
./node_modules/.bin/vitest run --config e2e/vitest.e2e.config.ts
```

两个用例：① Streamable HTTP 全链路真实两轮对话（含鉴权 + 轨迹断言）；② WebSocket 全链路真实对话（含 URL scheme 分流 + 鉴权）。
