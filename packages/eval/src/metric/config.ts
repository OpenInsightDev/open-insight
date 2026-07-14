import type { DataPoint } from "./chart.ts";

export type Config<R> = Readonly<{
  description?: string;
  chart?: (result: R) => PromiseLike<DataPoint> | DataPoint;
}>;
