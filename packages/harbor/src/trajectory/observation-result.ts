import { Schema } from "effect";
import { JsonRecord } from "../common/config.ts";
import { ContentPart } from "./content.ts";
import { SubagentTrajectoryRef } from "./subagent-trajectory-ref.ts";

export class ObservationResult extends Schema.Class<ObservationResult>("ObservationResult")({
  source_call_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  content: Schema.optionalKey(
    Schema.NullOr(Schema.Union([Schema.String, Schema.Array(ContentPart)])),
  ),
  subagent_trajectory_ref: Schema.optionalKey(Schema.NullOr(Schema.Array(SubagentTrajectoryRef))),
  extra: Schema.optionalKey(Schema.NullOr(JsonRecord)),
}) {}
