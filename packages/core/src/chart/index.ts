import type { BivariantFn } from "#/utils/variant.ts";
import type { Points } from "./schema.ts";

export type Chart<R = unknown> = BivariantFn<(input: R) => Points>;

export * from "./schema.ts";
