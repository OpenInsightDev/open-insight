import type { BivariantFn } from "#/utils/variant.ts";
import type { ComposablePoints, DataPoints } from "./schema.ts";

export type Return = DataPoints | ComposablePoints;
export type Chart<R = unknown> = BivariantFn<(input: R) => Return>;

export * from "./schema.ts";
