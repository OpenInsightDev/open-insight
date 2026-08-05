import { Schema } from "effect";
import { JsonRecord } from "#/common/config.ts";

export class Agent extends Schema.Class<Agent>("Agent")({
  name: Schema.String,
  version: Schema.String,
  model_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  tool_definitions: Schema.optionalKey(Schema.NullOr(Schema.Array(JsonRecord))),
  extra: Schema.optionalKey(Schema.NullOr(JsonRecord)),
}) {}
