export * from "./bench.ts";

import { make } from "./bench.ts";
import { result } from "./result.ts";
import * as Task from "#/task/index.ts";
import * as Grade from "#/grade/index.ts";
import { Schema } from "effect";

const taskA = Task.make("taskA", {
  grader: Grade.embed(
    Schema.Struct({ passed: Schema.Boolean }), //
    async () => ({ passed: true }),
  ),
}).pipe(
  Task.result(
    Schema.Struct({ passAt1: Schema.Number }), //
    async () => ({ result: { passAt1: 1 } }),
  ),
);

const taskB = Task.make("taskB", {
  grader: Grade.embed(
    Schema.Struct({ count: Schema.Number }), //
    async () => ({ count: 1 }),
  ),
}).pipe(
  Task.result(
    Schema.Struct({ total: Schema.Number }), //
    async () => ({ result: { total: 2 } }),
  ),
);

const bench = make({ name: "bench" }, taskA, taskB).pipe(
  result(
    Schema.Struct({ total: Schema.Number }), //
    async (tasks) => {
      return { result: { total: 1 } };
    },
  ),
);
