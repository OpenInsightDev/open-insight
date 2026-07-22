import { ComposablePoints, DataPoint } from "./schema.ts";

export type Chart<R = unknown> = (input: R) =>
  | DataPoint // a single data point for a standalone chart
  | ComposablePoints; // or multiple data points for a composable chart
