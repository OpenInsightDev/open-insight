# 设计文档：ACP 动态工具与「Tools Schema 未知」的处理原理

> 适用范围：`@mcpc/acp-ai-provider`
> 相关源码：`src/language-model.ts`、`src/acp-tool.ts`、`src/convert-utils.ts`

## 1. 问题背景

### 1.1 ACP 的模型

ACP（Agent Client Protocol）将 agent（Claude Code、Gemini CLI、Codex CLI 等）封装为可对话的**子进程**。和传统 LLM 调用不同，ACP 允许 agent 在运行过程中随时调用**任意工具**——bash、文件读写、编辑、搜索等。这些工具由 agent 自身声明与驱动，host（这里即 AI SDK 侧的应用）在调用前**并不知道它们的名称，更不知道它们的输入 Schema**。

同时，ACP 的通知（`SessionNotification`）是**流式、增量**的：

- `tool_call`：通知一个工具开始调用，携带 `toolCallId`、可选 `title`（即名字）和 `rawInput`（真实参数）。
- `tool_call_update`：工具的状态/输入/输出的增量更新；`rawInput` 可能在此补发，`rawOutput` 携带结果。
- 同一个 `toolCallId` 会收到多条通知，参数可能在后续通知中才完整。

### 1.2 AI SDK 的约束

AI SDK（`LanguageModelV3`）对流中每个 `tool-call` 部分有硬性要求：

1. `tool-call` 的 `toolName` 必须能在本次 `doStream`/`doGenerate` 传入的 `tools` 集合中找到；
2. 该工具的 `inputSchema` 需要能校验（或至少不拒绝）传给它的 `input`。

换言之，AI SDK 要求工具在**调用前可声明、Schema 已知**。而 ACP 的动态工具恰恰违反了这一前提（名称和 Schema 都未知），这就构成了核心矛盾。

### 1.3 矛盾的本质

> 动态工具的 Schema 在运行前不可知 ⇒ 无法在 `tools` 中按常规方式声明 ⇒ 无法通过 AI SDK 的工具名校验与 Schema 校验。

我们的设计目标：在不要求用户提前声明（也根本无法提前声明）agent 原生动态工具的前提下，把这些工具调用完整、稳定地桥接到 AI SDK 消息中。

---

## 2. 核心设计：降级与包装（Degrade & Wrap）

面对「Schema 未知」这一局限，我们的策略是**不试图补齐未知的 Schema，而是把它降级为不透明数据，并包装进一个「Schema 确定的载体」里**。

整个设计围绕一个关键决策展开：**流中发出的 `tool-call` 的 `toolName` 永远不使用 agent 的真实工具名，而是统一使用一个占位 Provider 工具名。**

### 2.1 占位 Provider 工具（Schema 开放）

在 `src/acp-tool.ts` 中定义了一个空的动态工具：

```ts
export const ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME =
  "acp.acp_provider_agent_dynamic_tool";

export function getACPDynamicTool() {
  return {
    [ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME]: tool({
      type: "provider",          // 声名为 provider 工具
      id: ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME,
      args: {},
      inputSchema: jsonSchema({}), // 空 schema = 全开放，接受任意输入
    }),
  };
}
```

要点：

- **`type: "provider"`**：声明为 provider 工具，AI SDK 对它不做严格的参数 schema 裁剪。
- **`inputSchema: jsonSchema({})`**：空 JSON Schema 是一个「通配」schema，对任何负载都校验通过。这样我们就能把所有未知形状的 agent 参数安全地塞进去。
- 该工具通过 `acpTools()` 与用户注册的工具合并后一并暴露给 AI SDK（`acp-tool.ts` 底部），因此它**总在声明的工具集合中**，满足约束 1。

### 2.2 包装对象（Schema 确定但很薄）

真实信息被包装成一个结构固定的对象，其 Schema 是「已知但很薄」的——只规定载体结构，参数本身保持 opaque：

```ts
export type ProviderAgentDynamicToolInput = {
  toolCallId: string;
  toolName: string;                       // 真实 agent 工具名
  args: Record<string, unknown>;          // 真实参数，Schema 未知 → opaque
};

export const providerAgentDynamicToolSchema = z.object({
  toolCallId: z.string(),
  toolName:   z.string(),
  args:       z.record(z.unknown()),      // 未知部分显式降级
});
```

至此，「未知 Schema」被隔离在 `args: Record<string, unknown>` 这一字段内，整个包装对象本身是类型安全、Schema 确定的。

---

## 3. 解码流程（ACP → AI SDK）

解码逻辑集中在 `src/language-model.ts` 的 `handleStreamNotification` 及其辅助函数中。

### 3.1 解析工具调用（真实信息从通知中剥离）

`parseToolCall` 从 `tool_call` 通知中提取：

| 来源 | 含义 |
| --- | --- |
| `update.toolCallId` | 稳定的工具调用标识 |
| `update.title \|\| update.toolCallId` | 工具名（`title` 缺失时回退到 id） |
| `update.rawInput ?? {}` | 真实参数（`content` 仅用于 UI 展示，不当作输入） |

关键注释：**`rawInput` 才是真实输入；`content` 是给 UI 展示用的（terminals、diffs、文本），不能用于参数**。

### 3.2 发出「包装后的 tool-call」

无论 agent 真实工具是什么，发出的 `tool-call` 一律使用占位工具名，输入为包装对象：

```ts
controller.enqueue({
  type: "tool-call",
  toolCallId,
  toolName: ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME, // 占位名
  input: JSON.stringify({
    toolCallId,
    toolName,      // 真实名字（或 title，或回退 toolCallId）
    args: toolInput,
  }),
});
```

这样，AI SDK 的工具名校验（约束 1）与 Schema 校验（约束 2）都因为「载体确定」而通过，而真实工具名/参数被完整保留在包装负载内，可供消费方后续处置（例如映射回 agent 会话、或由 host 侧执行并回执）。

### 3.3 结果解析（tool_call_update）

`parseToolResult` 取结果时同样遵循「raw 优先」原则：

```ts
const toolResult = update.rawOutput ?? update.content ?? null;
const isError = update.status === "failed";
```

- `rawOutput` 未提供时才回退到 `content`（部分 agent 不提供 `rawOutput`）。
- `status === "failed"` 标记为错误结果。

---

## 4. 未知/缺失场景的配套处理

「Schema 未知」只是起点，运行时还有大量「信息未知/缺失/晚到」的情况，均作了显式兜底。

### 4.1 工具名未知

ACP 的 `title` 可选。名字解析逻辑：

```ts
const toolName = update.title || update.toolCallId;
```

无真实名字时回退到 `toolCallId`，保证 `toolName` 字段永远非空。并在后续 `update.title` 到达且更优时，用 `toolInfo.name` 就地修正（比较时排除「title 恰等于 id」的无意义更新）。

### 4.2 输入缺失 / 晚到

`toolCallsMap` 负责缓存每个 `toolCallId` 的状态（`index`/`name`/`inputAvailable`）：

- 首次见到 `toolCallId` 先发 `tool-input-start`；
- 有 `rawInput`（`hasToolInput` 判定非空）立即发 `tool-call`；
- 若参数在后续 `tool_call_update` 的 `rawInput` 中才补发，则此时再发 `tool-call`；
- 若始终无输入，`flushPendingToolCalls` 在下一个不同类型通知到来前，以 `args: {}` 收尾补发，避免挂起。

辅助函数：

```ts
private normalizeToolInput(input: unknown) { return input ?? {}; } // undefined → {}
private hasToolInput(input: unknown) { /* 空对象/空串视为无输入 */ }
```

### 4.3 客户端工具结果反向识别

`isClientToolResult` 判断结果是否来自 host 侧执行的客户端工具（无 `execute`）：同时兼容 ACP `ToolCallContent`（`type: "content"`）与 MCP 文本（`type: "text"`）两种格式，以便从响应中重建 `toolName` 与 `args`，再送回 AI SDK 走统一的 client-tool 回执路径。

---

## 5. 对侧：AI SDK → ACP 时工具的筛选

解码侧回避了「Schema 未知」，编码侧（`convert-utils.ts` 的 `extractACPTools`）则避免把不可执行的工具塞给 agent：

- 仅转发「已注册 execute」且存在 `inputSchema` 的工具（`hasRegisteredExecute(t.name) && toolInputSchema`）；
- 客户端工具（`execute === undefined`）注册到 `executeRegistry` 但不转发给 agent，由 host 侧执行。

这保证传给 ACP 的 `tools` 每个都是命中可执行且 Schema 已知的，与解码侧的「已知载体 + 未知负载」对称互补。

---

## 6. 权衡与取舍

| 维度 | 取舍说明 |
| --- | --- |
| 工具名校验 | 牺牲「真实工具名直接可见」，换取稳定性：永远用占位名，真实名藏在负载里。AI SDK 对任意动态调用都放行。 |
| Schema 校验 | 不补齐未知 Schema，而是 `jsonSchema({})` 全开放 + `record<unknown>` 降级。未知参数不被强校验，也不被误拒。 |
| 类型安全 | 薄载体（id/name/args）仍保持类型安全；只有 `args` 内部是 opaque，隔离了不可知部分。 |
| 语义保真 | `rawInput`/`rawOutput` 优先于 `content`，避免把 UI 展示文本误当参数/结果。 |
| 代价 | 消费方需解析包装对象拿到真实 `toolName`/`args`；`args` 无法获得静态类型，只能运行时处理。 |

**一句话总结**：面对 ACP 动态工具「调用前 Schema 未知」的局限，库不做「全知」的尝试，而是把未知 Schema 降级为不透明负载（`record<unknown>`），用一个 Schema 全开放的占位 Provider 工具作为「确定载体」统一承载，从而让所有动态工具调用都能稳定、无误地穿过 AI SDK 的消息管线。
