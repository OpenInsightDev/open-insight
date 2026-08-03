# ai-sdk 消息格式 ↔ effect 消息格式转换调研

本文档调研 `.repos/effect-uai/packages/compat/ai-sdk/`（即 `@effect-uai/ai-sdk` 包）如何实现
Vercel AI SDK 消息格式与 effect（effect-uai core）消息格式之间的双向转换，为
`packages/core/src/prompt/builtin/vercel/` 的实现提供参考。

## 1. 包定位

`@effect-uai/ai-sdk` 是 effect-uai 的 Vercel AI SDK 兼容层，目标是：**前端 `@ai-sdk/react` 的
`useChat` 一行不改**，后端把 effect-uai 的 agent loop 当作 `streamText` 的替代品来服务。

整个包只有两个模块、两个函数，覆盖两个方向：

| 方向                  | 模块                 | 函数                | 转换                                             |
| --------------------- | -------------------- | ------------------- | ------------------------------------------------ |
| 入站（客户端 → loop） | `Messages.ts`        | `decodeMessages`    | `UIMessage[]` → `HistoryItem[]`                  |
| 出站（loop → 客户端） | `UIMessageStream.ts` | `toUIMessageStream` | `Stream<InteractionEvent>` → `Stream<SSE.Event>` |

关键设计：**包不拥有任何 HTTP 层**。出站只产出 `Stream<SSE.Event>` 和必需的
`responseHeaders`，由调用方自己接到 web `Response`、`@effect/platform` 的
`HttpServerResponse` 或裸 Node 服务器上。

```
POST /api/chat
  body: { messages: UIMessage[] }
        │  decodeMessages(messages)
        ▼
  HistoryItem[] ──▶ agent loop ──▶ Stream<InteractionEvent>
                                     │  toUIMessageStream(uuid)
                                     ▼
                                  Stream<SSE.Event>
                                     │  SSE.toBytes
                                     ▼
                                  Response + responseHeaders
```

## 2. 两边的消息格式

### 2.1 ai-sdk 侧（`UIMessage`，v1 wire 协议）

`useChat` 客户端 POST 的 `messages` 是 `UIMessage[]`，形状为：

```ts
type UIMessage = {
  id?: string;
  role: "user" | "assistant" | "system";
  parts: Array<UIPart>; // UIPart = { type: string; [k: string]: unknown }
};
```

`parts` 是开放联合，本包只关心三种：

- `text` part：`{ type: "text", text: string, state?: "done" }`
- `file` part：`{ type: "file", mediaType: string, url: string, ... }`
- tool part：**类型是动态的** —— `tool-<name>`（如 `tool-search`）或 `dynamic-tool`，因此无法用
  Schema Literal 匹配，只能**结构化识别**（有 `toolCallId` 就算 tool part），名字从 `type` 里抠出来：

  ```ts
  const toolName = (part) =>
    part.type === "dynamic-tool" ? (part.toolName ?? "") : part.type.slice("tool-".length);
  ```

  关键字段：`state`（`"input-available"` / `"output-available"` 等）、`input`、`output`、
  `toolCallId`、`toolName`。

### 2.2 effect 侧（effect-uai core `domain/Items.ts`、`domain/Turn.ts`）

**HistoryItem**（`Items.HistoryItem`）是一个 Schema Union，四种：

| type                   | 含义                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `message`              | 角色 `user` / `assistant` / `system`，`content` 是内容块数组 |
| `function_call`        | 工具调用，`call_id` + `name` + **JSON 字符串** `arguments`   |
| `function_call_output` | 工具结果，`call_id` + **JSON 字符串** `output`               |
| `reasoning`            | 推理（顶层的独立 item，OpenAI Responses 风格）               |

`Message.content` 的内容块（`ContentBlock`）：

- `input_text` / `input_image`（用户侧输入，`input_image.source` 是跨模态的 `ImageSource`：
  url / base64 / bytes）
- `output_text`（可带 `annotations` 引用）/ `refusal`（模型拒答）

**TurnEvent**（`Turn.TurnEvent`，TaggedEnum）——单轮生成过程中的流式事件：

```
TextDelta / ReasoningDelta / RefusalDelta / ToolCallStart / ToolCallArgsDelta /
UsageUpdate / WebSearchCall / CitationAdded / TurnComplete{ turn }
```

**InteractionEvent** = `TurnEvent | ToolCallOutput`（loop 跑完工具后追加的 `function_call_output`，
带 `_tag` 判别）。

**核心差异**：effect 侧工具调用参数/结果以 **JSON 字符串**承载；ai-sdk 侧 tool part 直接携带
**已解码的 JS 值**。出站要 decode，入站要 stringify。

## 3. 入站转换：`decodeMessages`（UIMessage → HistoryItem）

`decodeMessages(messages) => messages.flatMap(decodeMessage)`，一条 `UIMessage` 可能展开成
多条 `HistoryItem`。按角色分派（`Match.value(message.role)`）：

| UIMessage.role | 产物           | 规则                                                                                                                                                                         |
| -------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`         | 1 条 `Message` | 所有 `text` part 拼接成**一条** `input_text`（保持"文本在前、图片在后"的模型期望），每个 `image/*` 的 `file` part 变成一条 `input_image`（`Image.imageUrl(url, mediaType)`） |
| `system`       | 1 条 `Message` | `Items.systemText(textOf(message))`                                                                                                                                          |
| `assistant`    | 0..n 条        | 先 `assistantText`（若有文本），再对每个 tool part 展开 `function_call`（+ `function_call_output`）                                                                          |

tool part 的展开规则（`toolItems`）：

```ts
const call: ToolCall = {
  type: "function_call",
  call_id: part.toolCallId,
  name: toolName(part),
  arguments: JSON.stringify(part.input ?? {}),
};
// 只有 state === "output-available" 时才追加 function_call_output
// output 是字符串就直接用，否则 JSON.stringify
```

**丢弃规则**（刻意为之）：

- 非 `image/*` 的 `file` part（如 PDF）——model 不需要看到
- 未解析完成的 tool part（`state !== "output-available"` 时没有 output）——只留 `function_call`

schema 校验用 `Schema.is(...)` 做守卫，part 本身保持开放形状，由守卫收窄类型。

## 4. 出站转换：`toUIMessageStream`（InteractionEvent → UI Message Stream）

### 4.1 协议与 headers

出站目标协议是 AI SDK v5–v7 稳定的 **UI Message Stream（v1 wire 格式）**，即
`x-vercel-ai-ui-message-stream: v1` 对应的协议。该 header 缺失时客户端会回退到纯文本
text-stream 协议并忽略非文本 part，因此是**强制的**：

```ts
export const responseHeaders = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
  "x-vercel-ai-ui-message-stream": "v1",
};
```

每个 part 序列化成一条 SSE 的 `data:`（`JSON.stringify(part)`），结束发 `"[DONE]"`：

```ts
const event = (part: Part | "[DONE]") => ({
  data: part === "[DONE]" ? "[DONE]" : JSON.stringify(part),
});
```

### 4.2 Part 全集

```ts
type Part =
  | { type: "start"; messageId } // 流开头，一条
  | { type: "text-start" | "text-delta" | "text-end"; id; delta? }
  | { type: "reasoning-start" | "reasoning-delta" | "reasoning-end"; id; delta? }
  | { type: "tool-input-start"; toolCallId; toolName }
  | { type: "tool-input-delta"; toolCallId; inputTextDelta }
  | { type: "tool-input-available"; toolCallId; toolName; input }
  | { type: "tool-output-available"; toolCallId; output }
  | { type: `data-${string}`; id?; data; transient? } // 自定义类型化数据
  | { type: "message-metadata"; messageMetadata } // 定稿的每条消息元数据
  | { type: "error"; errorText }
  | { type: "finish" }; // 流结尾，后跟 [DONE]
```

### 4.3 事件映射表（`step` 函数，核心）

`Match.tags` 按 `_tag` 分派：

| InteractionEvent                                                  | 产物 part                                                                                      | 说明                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `TextDelta`                                                       | `text-start` + `text-delta`（首次）或仅 `text-delta`                                           | 见 4.4 block id 合成                                   |
| `ReasoningDelta`                                                  | `reasoning-start` + `reasoning-delta`（首次）或仅 `reasoning-delta`                            | 同上                                                   |
| `ToolCallStart`                                                   | `tool-input-start`                                                                             |                                                        |
| `ToolCallArgsDelta`                                               | `tool-input-delta`                                                                             | `inputTextDelta` 直接透传                              |
| `RefusalDelta`                                                    | `error`                                                                                        | 拒答 → 协议里的 error part                             |
| `TurnComplete`                                                    | `text-end` + `reasoning-end`（若有打开的块）+ 每个 `function_call` 一条 `tool-input-available` | 同时**重置** textId/reasoningId，为多轮做准备          |
| `function_call_output`（非 `_tag` 分支，`Match.when` 按形状匹配） | `tool-output-available`                                                                        | loop 跑完工具后追加                                    |
| `UsageUpdate`                                                     | 无                                                                                             | 用量走 `message-metadata` 或 `TurnComplete.turn.usage` |
| `WebSearchCall` / `CitationAdded`                                 | 无                                                                                             | 无对应 part；引用最终随 `TurnComplete.turn` 到达       |
| `dataPart(...)`（`kind: "data"`）                                 | `data-<name>`                                                                                  | 调用方可穿插自定义数据，`transient` 控制是否持久化     |
| `messageMetadata(...)`（`kind: "metadata"`）                      | `message-metadata`                                                                             | 定稿元数据（如 usage）                                 |

### 4.4 block id 合成（协议要求 vs effect 缺失的差异）

协议要求每个文本/推理块有**稳定 id 和显式 start/end 生命周期**，而 effect 的 delta 事件不携带这些。
本模块在 `mapAccum` 里维护一个 `State` 来合成：

```ts
type State = { messageId: string; textId: string | null; reasoningId: string | null; seq: number };
```

- 首个 `TextDelta` 打开块：id = `` `${messageId}:t${seq}` ``，同时发 `text-start` 和 `text-delta`
- 后续 delta 复用同一个 id
- `TurnComplete` 发 `text-end` / `reasoning-end` 并**把 id 置空**——因为工具解析后 loop 可能还会跑下一轮，新的一轮要开新块

每个事件（emission）可能扇出 0..n 个 part（首 delta 一拆二），所以 `step` 返回
`[State, Part[]]` 二元组，`mapAccum` 天然合适。

### 4.5 JSON 解码

effect 侧 `function_call.arguments` / `function_call_output.output` 是 JSON 字符串，客户端要的是
解码后的值。用 `Option.liftThrowable(JSON.parse)` + `Option.getOrElse(_, raw)` 兜底：能解析就
给对象，解析不了（比如纯文本工具结果）就给原始字符串。

### 4.6 出站流骨架

```ts
export const toUIMessageStream = (messageId: string) => (self) =>
  Stream.make(event({ type: "start", messageId })).pipe(
    Stream.concat(Stream.mapAccum(self, initialState, step)),
    Stream.concat(Stream.make(event({ type: "finish" }), event("[DONE]"))),
  );
```

首尾固定：`start` 开头，`finish` + `[DONE]` 结尾。

## 5. 验证方式

包里有两层测试：

1. `UIMessageStream.test.ts` —— 单元测试：直接对 `encode` 出的 part 序列断言（块 id 复用、
   tool 往返、refusal → error、data/metadata 穿插、入站折叠规则等）。
2. `conformance.test.ts` —— **一致性测试**：把编码出的 SSE 数据喂给 AI SDK 自己的客户端读取器
   `readUIMessageStream`（浏览器里 `useChat` 用的同一套组装逻辑），断言重建出的 `UIMessage`
   与预期一致。这把编码器钉死在真实协议实现上：将来 SDK 升级若字节不再满足协议，会在测试里
   失败而不是在用户的 app 里。

## 6. 对本项目（open-insight core）的启示

- 本地 `packages/core/src/prompt/` 基于 `effect/unstable/ai/Prompt`（Effect 自带 AI 模块），
  而 compat 包针对的是 effect-uai 的 `Items.HistoryItem` / `Turn.InteractionEvent`。要做
  `vercel/` 适配，需要先确定本地侧的统一消息模型，再按同样的双向思路实现：
  - 入站：`UIMessage[]` → 本地 Prompt/History 形状（文本拼接、图片折叠、tool part 结构化识别、
    未完成状态丢弃）
  - 出站：本地流式事件 → UI Message Stream part（合成 block id、`mapAccum` 状态机、
    JSON decode、`x-vercel-ai-ui-message-stream: v1` header）
- 值得直接复用的模式：
  - tool part 的动态 `type` 用**结构化识别**而非 Schema 字面量
  - 协议要求的 start/end 生命周期由转换层合成，模型侧保持纯 delta
  - 出站层不持有 HTTP，只产 `Stream<SSE.Event>` + headers
  - 用 AI SDK 官方 `readUIMessageStream` 做一致性测试钉住协议
