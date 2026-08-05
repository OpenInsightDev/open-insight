import { Schema } from "effect";
import { JsonRecord } from "../common/config.ts";

const SubagentTrajectoryRefFields = Schema.Struct({
  trajectory_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  session_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  trajectory_path: Schema.optionalKey(Schema.NullOr(Schema.String)),
  extra: Schema.optionalKey(Schema.NullOr(JsonRecord)),
}).check(
  Schema.makeFilter((input) => {
    if (
      (input.trajectory_id === undefined || input.trajectory_id === null) &&
      (input.trajectory_path === undefined || input.trajectory_path === null)
    ) {
      return "either 'trajectory_id' or 'trajectory_path' is required";
    }
    return undefined;
  }),
);

export class SubagentTrajectoryRef extends Schema.Class<SubagentTrajectoryRef>(
  "SubagentTrajectoryRef",
)(SubagentTrajectoryRefFields) {}
