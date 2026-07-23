import type { ComposablePoints, DataPoints } from "./schema.ts";
export type Chart<R = unknown> = (input: R) => DataPoints | ComposablePoints;
