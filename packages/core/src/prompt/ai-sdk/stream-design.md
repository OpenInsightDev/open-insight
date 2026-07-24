# Effect AI Stream to AI SDK Text Stream

本文描述如何把 `effect/unstable/ai` 的
`Stream.Stream<Response.StreamPart<Tools>, E, R>` 转换为 AI SDK v7 可消费的流。
设计基于当前目录已有的反向适配器（AI SDK `TextStreamPart` -> Effect
`Response.StreamPart`），但新方向不是简单的字段反转：AI SDK 的工具结果和审批事件需要
完整 tool call，而 Effect 的对应事件只保留 `toolCallId`，所以转换必须维护状态。

## 目标与边界

目标输出定义为：

```ts
ReadableStream<TextStreamPart<ToolSet>>;
```

选择 `TextStreamPart` 而不是其他 AI SDK 流类型的原因：

- 它是 `streamText().stream` 暴露的公开事件模型，和当前适配器使用的输入一致。
- AI SDK 的公开 `toUIMessageStream` 直接接受
  `ReadableStream<TextStreamPart<TOOLS>>`，因此输出可以继续进入 UI、SSE 和 Response
  相关 API。
- 不以 `LanguageModelV4StreamPart` 为目标。它是 provider 调用层协议，不包含
  framework 执行后的工具结果等完整生成循环事件。
- 不直接生成 `UIMessageChunk`。UI 选项、消息 ID、错误脱敏和消息持久化仍由 AI SDK
  的 `toUIMessageStream` 负责。
- 不伪造 `StreamTextResult`。Effect stream 不包含构造其 `text`、`steps`、
  `responseMessages` 等 Promise 所需的全部信息。

当前版本基于仓库依赖的 Effect `4.0.0-beta.98` 和 AI SDK `7.0.17`。

## 建议 API

保留现有 `transform` 和 `fromAiStream` 作为 AI SDK -> Effect 入口。新方向使用明确的
`toAiSdk*` 名称，不重载含义不清晰的 `transform`。

```ts
import type { TextStreamPart, ToolSet } from "ai";
import type { Effect, Stream } from "effect";
import type { Response, Tool } from "effect/unstable/ai";

export type AiSdkStreamPart = TextStreamPart<ToolSet>;

export type ToolCallContext = Extract<AiSdkStreamPart, { readonly type: "tool-call" }>;

export type ToAiSdkStreamOptions = Readonly<{
  initialToolCalls?: ReadonlyMap<string, ToolCallContext>;
}>;

export declare const toAiSdkParts: <Tools extends Record<string, Tool.Any>, E, R>(
  stream: Stream.Stream<Response.StreamPart<Tools>, E, R>,
  options?: ToAiSdkStreamOptions,
) => Stream.Stream<AiSdkStreamPart, E | EffectToAiSdkStreamError, R>;

export declare const toAiSdkStream: <Tools extends Record<string, Tool.Any>, E, R>(
  stream: Stream.Stream<Response.StreamPart<Tools>, E, R>,
  options?: ToAiSdkStreamOptions,
) => Effect.Effect<ReadableStream<AiSdkStreamPart>, never, R>;
```

`toAiSdkParts` 保留 Effect 的错误类型和环境类型，适合在 Effect 内继续组合或测试。
`toAiSdkStream` 是唯一的运行时边界：它通过 `Stream.toReadableStreamEffect` 捕获当前
Effect Context 并返回 Web `ReadableStream`。

`toAiSdkStream` 本身不会消费输入，所以构造 Effect 不失败；`E` 和
`EffectToAiSdkStreamError` 会在读取 `ReadableStream` 时以 stream error 结束读取。

不从 `ai/internal` 导入 `createAsyncIterableStream`。AI SDK 没有从公共入口导出这个构造器，
而 `toUIMessageStream` 只要求公开的 `ReadableStream` 合约。如果调用方只需要异步迭代，
应在 Effect 一侧使用 `Stream.toAsyncIterableEffect`，不在适配器里复制 AI SDK 私有实现。

## 转换流程

```text
Effect Stream<Response.StreamPart, E, R>
  -> prepend AI SDK `start`
  -> append an internal end-of-stream sentinel
  -> Stream.mapAccumEffect(state, convertPart)
  -> Stream<TextStreamPart, E | EffectToAiSdkStreamError, R>
  -> Stream.toReadableStreamEffect
  -> ReadableStream<TextStreamPart>
  -> AI SDK toUIMessageStream / createUIMessageStreamResponse
```

必须追加内部 sentinel，而不是只使用 `Stream.mapAccumEffect` 的 `onHalt`：`onHalt`
不能返回失败，无法在正常结束时报告 `MissingTerminal`、未闭合内容块等协议错误。

## 事件映射

| Effect `Response.StreamPart`        | AI SDK `TextStreamPart` | 规则                                                                                                                        |
| ----------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `text-start`                        | `text-start`            | 保留 `id`。                                                                                                                 |
| `text-delta`                        | `text-delta`            | `delta` 改名为 `text`。                                                                                                     |
| `text-end`                          | `text-end`              | 保留 `id`。                                                                                                                 |
| `reasoning-start`                   | `reasoning-start`       | 保留 `id`。                                                                                                                 |
| `reasoning-delta`                   | `reasoning-delta`       | `delta` 改名为 `text`。                                                                                                     |
| `reasoning-end`                     | `reasoning-end`         | 保留 `id`。                                                                                                                 |
| `tool-params-start`                 | `tool-input-start`      | `name` 改名为 `toolName`；默认标记 `dynamic: true`。                                                                        |
| `tool-params-delta`                 | `tool-input-delta`      | 保留 JSON 文本增量。                                                                                                        |
| `tool-params-end`                   | `tool-input-end`        | 保留 `id`。                                                                                                                 |
| `tool-call`                         | dynamic `tool-call`     | `id/name/params` 映射到 `toolCallId/toolName/input`，并缓存完整 call。                                                      |
| 成功 `tool-result`                  | dynamic `tool-result`   | `encodedResult` 作为 `output`；`input` 从缓存的 call 取得。                                                                 |
| 失败 `tool-result`                  | dynamic `tool-error`    | `encodedResult` 作为 `error`；`input` 从缓存的 call 取得。                                                                  |
| 拒绝执行的 `tool-result`            | `tool-output-denied`    | 仅在 `encodedResult` 符合 Effect 的 `{ type: "execution-denied" }` 或现有 `metadata.aiSdk.part.type` 明确为 denied 时使用。 |
| `tool-approval-request`             | `tool-approval-request` | 用 `toolCallId` 查缓存并嵌入完整 dynamic tool call。                                                                        |
| `file`                              | `file`                  | 用公开的 `DefaultGeneratedFile({ data, mediaType })` 包装 `Uint8Array`。                                                    |
| `file`（原始类型为 reasoning file） | `reasoning-file`        | 仅当当前适配器留下的 `metadata.aiSdk.part.type` 为 `reasoning-file` 时恢复。原生 Effect part 无法表达该区别。               |
| URL `source`                        | URL `source`            | `URL` 转成字符串，保留 `id/title`。                                                                                         |
| document `source`                   | document `source`       | `fileName` 改名为 `filename`。                                                                                              |
| `response-metadata`                 | `custom`                | 使用 `kind: "effect.response-metadata"`；内容放在 namespaced provider metadata 中。                                         |
| `finish`                            | `finish`                | 延迟到 Effect 输入正常结束时发出，确保它是最后一个 AI SDK part。                                                            |
| `finish`（原始类型为 abort）        | `abort`                 | 仅当 `metadata.aiSdk.part.type` 为 `abort` 时恢复；原生 Effect `unknown` finish 仍是 finish。                               |
| `error`                             | `error`                 | 这是数据事件，发出后继续消费上游；不同于 Effect stream error。                                                              |

转换器在首个 Effect part 之前固定发出一次 `{ type: "start" }`。Effect 没有 step
生命周期模型，因此不合成 `start-step` 或 `finish-step`。这些事件对
`toUIMessageStream` 的文本、推理、工具和 finish 状态不是必需的；伪造 request、
response、performance 或 per-step usage 会给调用方错误信息。

## 状态模型

每次订阅创建独立状态，不在模块级共享可变对象：

```ts
type State = Readonly<{
  activeText: ReadonlySet<string>;
  activeReasoning: ReadonlySet<string>;
  activeToolParams: ReadonlySet<string>;
  toolCalls: ReadonlyMap<string, ToolCallContext>;
  pendingTerminal:
    | Readonly<{ type: "finish"; part: Response.FinishPart }>
    | Readonly<{ type: "abort"; reason?: string }>
    | undefined;
  lastPartWasError: boolean;
}>;
```

状态机执行以下约束：

1. 同一个 `id` 不能重复 start；delta 和 end 必须引用已打开的同类 block。
2. `text-end`、`reasoning-end`、`tool-params-end` 关闭对应 block。
3. `tool-call.id` 在一次响应内唯一；重复 ID 或同 ID 不同名称是转换错误。
4. `tool-result.name` 必须与已缓存 call 的名称一致。
5. 只允许一个 Effect `finish`。收到后根据 origin metadata 存成 pending `finish` 或
   `abort`，不立即输出。
6. pending `finish` 之后只允许关闭已经打开的 block；新的 start、delta、tool call、result、
   source、file 或 error 都是 `PartAfterTerminal`。pending `abort` 后不允许任何 part。
7. 处理 sentinel 时按终止类型收尾：
   - pending `finish` 要求所有 block 已关闭，随后输出 metadata companion 和唯一 finish。
   - pending `abort` 允许 block 未闭合，输出 metadata companion 和唯一 abort。
   - 没有 pending terminal、但最后一个 Effect part 是 `error` 时直接正常结束；AI SDK
     自身也会在初始化或模型调用失败时发出 error 后关闭而不发 finish。
   - 其他情况失败为 `MissingTerminal`。

延迟 finish 可以兼容 Effect provider 先给 usage/finish、随后才关闭 text block 的情况，
同时不需要由适配器猜测缺失的 end part。如果上游正常结束但缺少 finish 或存在未闭合
block，且也不是 recovered abort 或 terminal error，流以类型化转换错误结束，不自动补
end、usage 或 finish。

## Tool Call 关联

AI SDK 的 `tool-result` 和 `tool-error` 都要求 `input`；`tool-approval-request` 更要求完整
`toolCall`。Effect 的结果和审批 part 只有 `id/name`，因此缓存不是可选优化，而是正确性
要求。

处理 `tool-call` 时，转换器先创建最终要输出的 dynamic AI SDK call，再把它存入
`toolCalls`。后续 result、error 和 approval 均从该缓存读取，避免分别重建导致字段不一致。

Effect 在处理上一轮审批后，可能在新一轮 stream 开头发出 pre-resolved tool result；
对应 call 不一定在当前 stream 中。调用方必须通过 `initialToolCalls` 注入会话历史中的
call。若当前状态和 `initialToolCalls` 都找不到 call，转换失败为 `MissingToolCall`。

不采用以下 fallback：

- 不把缺失的 `input` 填成 `undefined`。虽然 dynamic tool 的 TypeScript 类型允许
  `unknown`，这会产生语义不完整的 `TextStreamPart`。
- 不在 orphan result 前合成一个 tool call。那会把历史结果伪装为本轮模型动作，并可能
  触发 AI SDK `onToolCall` 再次执行工具。
- 不静默丢弃 orphan result。它会让 Effect Chat 历史和 UI 历史分叉。

所有工具事件默认输出为 `dynamic: true`，因为 Effect `Toolkit` 的 Schema 不能仅凭 stream
part 转换成 AI SDK `ToolSet`。调用 `toUIMessageStream` 时仍可传入真正的 AI SDK `tools`；
AI SDK 会根据该集合决定 UI 中使用静态还是 dynamic tool part。

## Usage 与 Finish Reason

Effect usage 到 AI SDK `LanguageModelUsage` 的映射如下：

| AI SDK 字段                          | Effect 来源                                                         |
| ------------------------------------ | ------------------------------------------------------------------- |
| `inputTokens`                        | `usage.inputTokens.total`                                           |
| `inputTokenDetails.noCacheTokens`    | `usage.inputTokens.uncached`                                        |
| `inputTokenDetails.cacheReadTokens`  | `usage.inputTokens.cacheRead`                                       |
| `inputTokenDetails.cacheWriteTokens` | `usage.inputTokens.cacheWrite`                                      |
| `outputTokens`                       | `usage.outputTokens.total`                                          |
| `outputTokenDetails.textTokens`      | `usage.outputTokens.text`                                           |
| `outputTokenDetails.reasoningTokens` | `usage.outputTokens.reasoning`                                      |
| `totalTokens`                        | input/output total 至少一个存在时，将存在值相加；否则为 `undefined` |

`stop`、`length`、`content-filter`、`tool-calls`、`error`、`other` 可直接映射。
Effect 额外支持的 `pause` 和 `unknown` 映射为 AI SDK `finishReason: "other"`，并把原值放入
`rawFinishReason`。对于其余值，优先恢复当前适配器保存在
`metadata.aiSdk.part.rawFinishReason` 中的原始原因；原生 Effect finish 没有原始原因时保持
`undefined`，不把标准化原因伪装成 provider 原始值。

Effect `FinishPart.response` 在 AI SDK 全局 finish part 中没有对应字段。若它存在，先输出
一个 `kind: "effect.finish-metadata"` 的 custom part，再在流末尾输出 finish。

## Metadata 规则

Effect metadata 是 `Record<string, Json | null>`，AI SDK provider metadata 是更严格的
`Record<string, JSONObject>`。不能直接用类型断言复制。

转换按以下优先级处理：

1. 若存在当前反向适配器生成的 `metadata.aiSdk.providerMetadata`，先用 Schema 验证其是否
   满足 AI SDK 的两层 object 结构；验证成功后恢复为原始 `providerMetadata`。
2. `metadata.aiSdk.part` 只用于恢复转换时丢失但目标字段需要的信息，例如
   `dynamic/title/toolMetadata`、`reasoning-file` 和 `rawFinishReason`。不得把它整体混入
   provider namespace。
3. 对原生 Effect metadata，输出为
   `{ effect: { metadata: <原 metadata> } }`。这样既满足 AI SDK 外层 provider、内层
   JSONObject 的约束，又不会冒充 OpenAI、Anthropic 等 provider 的原生 metadata。
4. 目标 part 没有 `providerMetadata` 字段时（如 `finish`、`error`、approval 和 denied），
   非空 metadata 通过紧邻目标事件之前的 `custom` companion part 保存，kind 使用
   `effect.<source-type>-metadata`。
5. 若 `metadata.aiSdk.providerMetadata` 形状无效，不抛 defect，也不做不安全断言；把完整
   Effect metadata 走第 3 条的 namespaced 路径。

`response-metadata` 没有直接目标 part，它的 custom envelope 使用以下固定结构；
`timestamp` 和 `request` 通过对应 Effect Schema 编码，而不是手写字符串转换：

```ts
{
  type: "custom",
  kind: "effect.response-metadata",
  providerMetadata: {
    effect: {
      part: {
        type: "response-metadata",
        id,
        modelId,
        timestamp,
        request,
      },
      metadata,
    },
  },
}
```

当前 AI SDK -> Effect 适配器把 `start`、step lifecycle、`raw`、approval response 等多个
AI SDK 事件折叠成 `response-metadata`。其中部分值可能已经因非 JSON 数据被替换为 omission
marker，所以反向转换不承诺重建这些 lifecycle 事件。它们统一成为
`effect.response-metadata` custom part；这是可观察、可传输且不会伪造字段的降级方式。

注意：AI SDK 的 `toUIMessageStream` 会把 provider metadata 继续发送到客户端。调用方必须
把 Effect metadata 当作潜在敏感数据，在进入本适配器前移除不应暴露的 provider/request
信息；适配器不负责猜测哪些业务字段需要脱敏。

## 错误、取消与背压

错误分成三类：

- Effect 输入 stream 的 `E`：保持在 Effect error channel；转成 Web stream 后成为终止
  读取的 stream error。
- `Response.ErrorPart`：映射为 AI SDK `{ type: "error", error }` 数据事件，不终止流。
- 适配器协议错误：使用 `EffectToAiSdkStreamError` 进入 error channel，不转换成 AI SDK
  error part，否则调用方无法区分“模型报告错误”和“适配器产生了非法事件流”。

`EffectToAiSdkStreamError` 至少区分以下 reason，并携带相关 `partType`/`id`：

- `DuplicateStart`
- `MissingStart`
- `DuplicateToolCall`
- `MissingToolCall`
- `ToolNameMismatch`
- `DuplicateTerminal`
- `PartAfterTerminal`
- `UnclosedPart`
- `MissingTerminal`

Web stream 边界使用 Effect 自带的 `Stream.toReadableStreamEffect`：

- Web stream 的 pull 驱动 Effect stream，保留背压，不提前收集全量结果。
- `ReadableStream.cancel()` 会 interrupt 运行输入 stream 的 fiber，Effect scope 和 finalizer
  因此正常执行。
- 输入失败通过 `Cause.squash` 成为 Web stream error。进入 Web API 后错误类型参数不可见，
  这是 Web `ReadableStream` 合约的限制。
- 取消不是 `abort` 数据事件。消费者取消代表不再需要数据，不应再向已取消的 stream
  enqueue 一个事件。

## 使用方式

```ts
import { toUIMessageStream } from "ai";
import { Effect } from "effect";
import { toAiSdkStream } from "./stream.ts";

const program = Effect.gen(function* () {
  const stream = agent.prompt({ prompt });
  const aiSdkStream = yield* toAiSdkStream(stream, {
    initialToolCalls: previousToolCalls,
  });

  return toUIMessageStream({
    stream: aiSdkStream,
    sendReasoning: true,
    sendSources: true,
  });
});
```

Effect 环境必须在 `toAiSdkStream` 的构造 Effect 处提供，因为该函数在此捕获 Context；
不能返回一个仍要求 `R`、但在任意 Promise 环境中才尝试查找服务的裸 stream。

## 实现顺序

1. 定义 `EffectToAiSdkStreamError`、`State`、内部 sentinel 和 metadata decoder。
2. 实现纯字段转换辅助函数：usage、finish reason、file、source 和 provider metadata。
3. 用 `Stream.mapAccumEffect` 实现边界校验、tool call 缓存和 finish 延迟。
4. 在转换结果前拼接唯一 `start`，用 sentinel 完成正常结束校验并发出 finish 或 abort。
5. 用 `Stream.toReadableStreamEffect` 实现 Web stream 边界。
6. 保持现有 AI SDK -> Effect API；新增导出使用 `toAiSdkParts` 和 `toAiSdkStream`。

## 测试要求

至少覆盖以下行为：

- text/reasoning/tool params 的 start-delta-end 顺序和字段映射。
- 同时打开 text 与 reasoning block 时状态彼此独立。
- tool call -> preliminary result -> final result，以及失败和 execution-denied 分支。
- approval request 使用当前 stream call 和 `initialToolCalls` 两种关联来源。
- orphan result/approval、名称不一致、重复 ID 均产生类型化错误。
- file、reasoning-file、URL source、document source 的映射。
- usage 的全量、部分和全部 `undefined` 三种情况。
- `pause`/`unknown` finish reason 转成 `other` 并保留 raw reason。
- finish 早于 block end 时被延迟；重复 terminal、缺失 terminal、finish 前未闭合 block
  失败。
- origin abort 被恢复且允许中断未闭合 block；最后一个 error 可以不带 finish 正常结束。
- Effect stream error 终止读取，而 `Response.ErrorPart` 作为数据继续流动。
- AI SDK origin metadata 能恢复，原生 Effect metadata 被放入 `effect` namespace。
- `ReadableStream.cancel()` 会运行 Effect finalizer。
- 输出可直接传给 AI SDK `toUIMessageStream`，并能由 `readUIMessageStream` 消费为完整消息。

## 已知限制

- 该设计表示一条 Effect stream 对应一条 AI SDK 响应；不从 Effect part 猜测多 step 边界。
- 原生 Effect `file` 无法区分普通文件和 reasoning file，只能默认输出 `file`。
- Effect approval request 没有 `isAutomatic`/`signature`；只有来自当前 AI SDK 反向适配器的
  metadata 才能恢复这些字段。
- 工具统一使用 dynamic 事件类型；要恢复静态工具类型，必须额外引入 Effect Toolkit 到
  AI SDK ToolSet 的 schema 适配，这不属于 stream 转换职责。
- 跨轮次 tool result/approval 需要调用方提供 `initialToolCalls`。缺少历史上下文时设计选择
  明确失败，而不是输出看似合法但语义不完整的 AI SDK part。
