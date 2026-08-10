import { Data } from "effect";

/**
 * A stage is one named checkpoint on the agent lifecycle at which a hook may
 * fire. This is a plain tagged enum (discriminated on `_tag`), intentionally
 * Schema-free: a stage only names *where* in the flow a hook runs, so each
 * variant carries no payload.
 *
 * The fleet of stages is derived from the hook points of mainstream agent
 * frameworks—OpenAI Agents SDK (RunHooks/AgentHooks), the Anthropic Claude
 * Agent SDK, the AI SDK / Cloudflare Think run loop, Browser Use, CrewAI and
 * Hugging Face smolagents—and collapsed onto a single, framework-agnostic
 * lifecycle.
 *
 * Lifecycle at a glance:
 *
 * ```text
 * SessionStart
 *   └─ UserPrompt ─ TurnEnd            (per user turn)
 *        StepStart ─ StepEnd           (per model step in the agentic loop)
 *          ├─ LlmStart   ─ LlmEnd      (per raw model call)
 *          ├─ ToolCall   ─ ToolResult  ─ ToolFailure   (per tool invocation)
 *          └─ Handoff                  (per agent handoff / sub-agent)
 * AgentStart ─ AgentEnd                (per agent being invoked)
 * Compact                              (before context compaction)
 * Error                                (a turn crashed)
 * SessionEnd
 * ```
 */
export type Stage = Data.TaggedEnum<{
  /** The session/thread has been created, before the first turn. (Claude SDK `SessionStart`, Cloudflare `configureSession`.) */
  SessionStart: {};
  /** The session has ended and is being torn down. (Claude SDK `SessionEnd`.) */
  SessionEnd: {};
  /** A user prompt has been submitted but not yet processed; may validate or enrich it. (Claude SDK `UserPromptSubmit`, AI SDK `beforeTurn`.) */
  UserPrompt: {};
  /** A turn completed and its assistant message was produced/persisted. (Cloudflare `onChatResponse`, Browser Use `on_step_end`.) */
  TurnEnd: {};
  /** An agent is about to be invoked (fires again on every handoff target / sub-agent). (OpenAI SDK `on_agent_start`, CrewAI `before_kickoff`.) */
  AgentStart: {};
  /** An agent produced its final output or stopped. (OpenAI SDK `on_agent_end`, Claude SDK `Stop`, CrewAI `after_kickoff`.) */
  AgentEnd: {};
  /** Control is being handed off from one agent to another (incl. sub-agent start/stop). (OpenAI SDK `on_handoff`, Claude SDK `SubagentStart`/`SubagentStop`.) */
  Handoff: {};
  /** A single model step of the agentic loop is about to run. (AI SDK `beforeStep`, Browser Use `on_step_start`.) */
  StepStart: {};
  /** A single model step of the agentic loop completed. (AI SDK `onStepFinish`, Browser Use `on_step_end`.) */
  StepEnd: {};
  /** A raw LLM call is about to be made. (OpenAI SDK `on_llm_start`, CrewAI `before_llm_usage`.) */
  LlmStart: {};
  /** A raw LLM call returned. (OpenAI SDK `on_llm_end`, CrewAI `after_llm_usage`.) */
  LlmEnd: {};
  /** A tool is about to execute; may allow/block/rewrite the call. (Claude SDK `PreToolUse`, AI SDK `beforeToolCall`, OpenAI SDK `on_tool_start`.) */
  ToolCall: {};
  /** A tool returned successfully. (Claude SDK `PostToolUse`, AI SDK `afterToolCall`, OpenAI SDK `on_tool_end`.) */
  ToolResult: {};
  /** A tool call failed. (Claude SDK `PostToolUseFailure`.) */
  ToolFailure: {};
  /** The conversation is about to be compacted; may preserve critical context. (Claude SDK `PreCompact`.) */
  Compact: {};
  /** A turn crashed; may classify and/or rewrite the error. (Cloudflare `onChatError`/`classifyChatError`.) */
  Error: {};
}>;
const Stage = Data.taggedEnum<Stage>();
export { Stage };
