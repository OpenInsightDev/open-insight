import { DataPoint } from "./schema.ts";

export type Chart<R = unknown> = (input: R) => DataPoint;
