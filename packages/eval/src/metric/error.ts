import { Schema } from "effect";

export class MetricError extends Schema.TaggedError<MetricError>("open-insight/eval/MetricError")(
  "MetricError",
  {},
) {}
