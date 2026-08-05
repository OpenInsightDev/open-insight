import { Schema } from "effect";
import { JsonRecord } from "../common/config.ts";

export class ToolCall extends Schema.Class<ToolCall>("ToolCall")({
  tool_call_id: Schema.String,
  function_name: Schema.String,
  arguments: JsonRecord,
  extra: Schema.optionalKey(Schema.NullOr(JsonRecord)),
}) {}
