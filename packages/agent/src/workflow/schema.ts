/**
 * Durable data model for the agent task workflow (`activity` module).
 *
 * Everything that crosses the workflow journal must be a `Schema`, so every
 * record the durable loop produces (model steps, tool batches, checkpoints,
 * stage verdicts) is declared here as a schema class.
 *
 * Design notes:
 *
 * - `TaskInput` carries the acceptance DAG, which is built before the task
 *   starts and is agent-independent (see `ONBOARD.md` "长程状态管理").
 *   Edges may be *refined* at runtime (an edge replaced by a subgraph), but
 *   the topology never changes, so the workflow structure stays deterministic.
 * - The trajectory is never stored as one blob: each model step / tool batch /
 *   checkpoint result is journaled incrementally, and the trajectory is
 *   re-folded from the journal on resume.
 * - The durable record of the agent's workspace mutations lives in
 *   `CheckpointRecord` (git commit hashes), not in the journal payloads.
 */
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// workspace spec
// ---------------------------------------------------------------------------

export class SandboxSpec extends Schema.Class<SandboxSpec>("open-insight/Activity/SandboxSpec")({
  image: Schema.String,
  cwd: Schema.optionalKey(Schema.String),
}) {}

export class ToolkitSpec extends Schema.Class<ToolkitSpec>("open-insight/Activity/ToolkitSpec")({
  name: Schema.String,
}) {}

// ---------------------------------------------------------------------------
// acceptance DAG (stage acceptance criteria)
// ---------------------------------------------------------------------------

export class StageCheck extends Schema.Class<StageCheck>("open-insight/Activity/StageCheck")({
  id: Schema.String,
  description: Schema.String,
}) {}

export class Stage extends Schema.Class<Stage>("open-insight/Activity/Stage")({
  id: Schema.String,
  title: Schema.String,
  checks: Schema.Array(StageCheck),
}) {}

export class AcceptanceDag extends Schema.Class<AcceptanceDag>(
  "open-insight/Activity/AcceptanceDag",
)({
  stages: Schema.Array(Stage),
}) {}

// ---------------------------------------------------------------------------
// durable step records (the journal of the agent loop)
// ---------------------------------------------------------------------------

export class UsageStats extends Schema.Class<UsageStats>("open-insight/Activity/UsageStats")({
  inputTokens: Schema.Int,
  outputTokens: Schema.Int,
}) {}

export class ToolCall extends Schema.Class<ToolCall>("open-insight/Activity/ToolCall")({
  id: Schema.String,
  name: Schema.String,
  params: Schema.Json,
}) {}

export class ToolResultOk extends Schema.Class<ToolResultOk>("open-insight/Activity/ToolResultOk")({
  _tag: Schema.tag("ok"),
  value: Schema.Json,
}) {}

export class ToolResultFail extends Schema.Class<ToolResultFail>(
  "open-insight/Activity/ToolResultFail",
)({
  _tag: Schema.tag("fail"),
  error: Schema.Json,
}) {}

export const ToolResult = Schema.Union([ToolResultOk, ToolResultFail]);
export type ToolResult = Schema.Schema.Type<typeof ToolResult>;

export class TextPart extends Schema.Class<TextPart>("open-insight/Activity/TextPart")({
  _tag: Schema.tag("text"),
  text: Schema.String,
}) {}

export class ToolCallPart extends Schema.Class<ToolCallPart>("open-insight/Activity/ToolCallPart")({
  _tag: Schema.tag("tool-call"),
  call: ToolCall,
}) {}

export class ToolResultPart extends Schema.Class<ToolResultPart>(
  "open-insight/Activity/ToolResultPart",
)({
  _tag: Schema.tag("tool-result"),
  result: ToolResult,
}) {}

export class FinishPart extends Schema.Class<FinishPart>("open-insight/Activity/FinishPart")({
  _tag: Schema.tag("finish"),
  reason: Schema.String,
  usage: UsageStats,
}) {}

export const StepPart = Schema.Union([TextPart, ToolCallPart, ToolResultPart, FinishPart]);
export type StepPart = Schema.Schema.Type<typeof StepPart>;

export class ModelStepRecord extends Schema.Class<ModelStepRecord>(
  "open-insight/Activity/ModelStepRecord",
)({
  step: Schema.Int,
  parts: Schema.Array(StepPart),
  usage: UsageStats,
}) {}

export class ToolBatchRecord extends Schema.Class<ToolBatchRecord>(
  "open-insight/Activity/ToolBatchRecord",
)({
  calls: Schema.Array(ToolCall),
  results: Schema.Array(ToolResult),
}) {}

export class CheckpointRecord extends Schema.Class<CheckpointRecord>(
  "open-insight/Activity/CheckpointRecord",
)({
  commit: Schema.String,
  message: Schema.String,
}) {}

export class CheckResult extends Schema.Class<CheckResult>("open-insight/Activity/CheckResult")({
  id: Schema.String,
  passed: Schema.Boolean,
  detail: Schema.optionalKey(Schema.String),
}) {}

export class StageVerdict extends Schema.Class<StageVerdict>("open-insight/Activity/StageVerdict")({
  stage: Schema.String,
  passed: Schema.Boolean,
  checks: Schema.Array(CheckResult),
}) {}

// ---------------------------------------------------------------------------
// human review (suspend / resume)
// ---------------------------------------------------------------------------

export class Approved extends Schema.Class<Approved>("open-insight/Activity/Approved")({
  _tag: Schema.tag("approved"),
  note: Schema.optionalKey(Schema.String),
}) {}

export class Rejected extends Schema.Class<Rejected>("open-insight/Activity/Rejected")({
  _tag: Schema.tag("rejected"),
  reason: Schema.String,
}) {}

export const Approval = Schema.Union([Approved, Rejected]);
export type Approval = Schema.Schema.Type<typeof Approval>;

// ---------------------------------------------------------------------------
// task contract
// ---------------------------------------------------------------------------

export class TaskInput extends Schema.Class<TaskInput>("open-insight/Activity/TaskInput")({
  taskId: Schema.String,
  instruction: Schema.String,
  sandbox: SandboxSpec,
  toolkits: Schema.Array(ToolkitSpec),
  acceptance: AcceptanceDag,
  maxSteps: Schema.Int,
}) {}

export class TaskResult extends Schema.Class<TaskResult>("open-insight/Activity/TaskResult")({
  answer: Schema.String,
  artifacts: Schema.Array(Schema.String),
  usage: UsageStats,
}) {}
