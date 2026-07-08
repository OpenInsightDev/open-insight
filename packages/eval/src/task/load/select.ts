import { Effect, Random } from "effect";
import type { Tasks } from "../build.ts";

export const skip = (n: number) => Effect.map((tasks: Tasks) => tasks.slice(n));

export const select = (n: number) => Effect.map((tasks: Tasks) => tasks.slice(0, n));

export const randomSelect = (taskCount: number) =>
  Effect.flatMap(
    Effect.fn(function* (tasks: Tasks) {
      const shuffled = yield* Random.shuffle(tasks);
      return shuffled.slice(0, taskCount);
    }),
  );
