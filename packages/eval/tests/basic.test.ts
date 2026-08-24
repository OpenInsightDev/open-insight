import { Schema } from "effect";
import { Task, Bench, Grade } from "#/export.ts";
import { Tool, Toolkit } from "effect/unstable/ai";

const taskA = Task.make("taskA", {
  prompt: { init: [] },
  grader: Grade.embed(
    Schema.Struct({ passed: Schema.Boolean }), //
    async () => ({ passed: true }),
  ),
}).pipe(
  Task.result(
    Schema.Struct({ passAt1: Schema.Number }), //
    async () => ({ passAt1: 1 }),
  ),
  Task.toolkit(
    Toolkit.make(
      Tool.make("toolA", {}), //
    ),
  ),
);

const taskB = Task.make("taskB", {
  prompt: { init: [] },
  grader: Grade.embed(
    Schema.Struct({ count: Schema.Number }), //
    async () => ({ count: 1 }),
  ),
}).pipe(
  Task.result(
    Schema.Struct({ total: Schema.Number }), //
    async () => ({ total: 2 }),
  ),
  Task.extra(
    Schema.Struct({ category: Schema.String }), //
    { category: "test" },
  ),
);

const bench = Bench.make({ id: "bench" }, taskA, taskB).pipe(
  Bench.mapTask(
    "taskA",
    Task.result(
      Schema.Struct({ passAt2: Schema.Number }), //
      async (trails) => ({ passAt2: 2 }),
    ),
  ),
  Bench.result(
    Schema.Struct({ total: Schema.Number }), //
    async ({ taskA }) => {
      taskA.result.passAt2;
      return { total: 1 };
    },
  ),
);
