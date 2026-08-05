import { Schema } from "effect";
import { ObservationResult } from "./observation-result.ts";

export class Observation extends Schema.Class<Observation>("Observation")({
  results: Schema.Array(ObservationResult),
}) {}
