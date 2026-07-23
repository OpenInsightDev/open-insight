import { ComposablePoints, DataPoint } from "./schema.ts";

export type Chart<R = unknown> = (input: R) =>
  // TODO 一个 grade 结果包含多个字段，因此也可能同时产出多个数据点
  | DataPoint // a single data point for a standalone chart
  | ComposablePoints; // or multiple data points for a composable chart
