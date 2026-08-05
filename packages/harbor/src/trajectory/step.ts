import { Schema } from "effect";
import { JsonRecord } from "../common/config.ts";
import { ContentPart } from "./content.ts";
import { Metrics } from "./metrics.ts";
import { Observation } from "./observation.ts";
import { ToolCall } from "./tool-call.ts";

const IsoTimestamp = Schema.String.check(
  Schema.makeFilter((input) =>
    Number.isNaN(Date.parse(input)) ? "timestamp must be a valid ISO 8601 string" : undefined,
  ),
);

const StepFields = Schema.Struct({
  step_id: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  timestamp: Schema.optionalKey(Schema.NullOr(IsoTimestamp)),
  source: Schema.Literals(["system", "user", "agent"]),
  model_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  reasoning_effort: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  message: Schema.Union([Schema.String, Schema.Array(ContentPart)]),
  reasoning_content: Schema.optionalKey(Schema.NullOr(Schema.String)),
  tool_calls: Schema.optionalKey(Schema.NullOr(Schema.Array(ToolCall))),
  observation: Schema.optionalKey(Schema.NullOr(Observation)),
  metrics: Schema.optionalKey(Schema.NullOr(Metrics)),
  is_copied_context: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  llm_call_count: Schema.optionalKey(
    Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  ),
  extra: Schema.optionalKey(Schema.NullOr(JsonRecord)),
}).check(
  Schema.makeFilter((input) => {
    if (input.source !== "agent") {
      if (input.model_name !== undefined && input.model_name !== null) {
        return "'model_name' is only allowed when source is 'agent'";
      }
      if (input.reasoning_effort !== undefined && input.reasoning_effort !== null) {
        return "'reasoning_effort' is only allowed when source is 'agent'";
      }
      if (input.reasoning_content !== undefined && input.reasoning_content !== null) {
        return "'reasoning_content' is only allowed when source is 'agent'";
      }
      if (input.tool_calls !== undefined && input.tool_calls !== null) {
        return "'tool_calls' is only allowed when source is 'agent'";
      }
      if (input.metrics !== undefined && input.metrics !== null) {
        return "'metrics' is only allowed when source is 'agent'";
      }
    }

    if (
      input.source === "agent" &&
      input.llm_call_count === 0 &&
      ((input.metrics !== undefined && input.metrics !== null) ||
        (input.reasoning_content !== undefined && input.reasoning_content !== null))
    ) {
      return "'metrics' and 'reasoning_content' must be absent when llm_call_count is 0";
    }

    return undefined;
  }),
);

export class Step extends Schema.Class<Step>("Step")(StepFields) {}
