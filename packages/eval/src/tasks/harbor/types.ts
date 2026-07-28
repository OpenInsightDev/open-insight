import type * as Task from "#/task/index.ts";
import type { Metadata } from "./config.ts";
import type { GradeResult } from "./reward.ts";

export type HarborTask = Task.Task<GradeResult, Metadata>;
