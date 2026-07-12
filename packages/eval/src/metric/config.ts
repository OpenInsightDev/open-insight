import type { DataPoint } from "./chart.ts";

export type Config<R> = Readonly<{
  name?: string;
  description?: string;
  chart?: (result: R) => PromiseLike<DataPoint> | DataPoint;
}>;
