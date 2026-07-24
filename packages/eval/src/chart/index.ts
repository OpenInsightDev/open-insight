import type { BivariantFn } from "#/utils/variant.ts";
import type { ComposablePoints, DataPoints } from "./schema.ts";

export type Chart<R = unknown> = BivariantFn<(input: R) => DataPoints | ComposablePoints>;
export * from "./schema.ts";
