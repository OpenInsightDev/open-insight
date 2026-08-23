import { Schema } from "effect";
import { Task, Bench, Grade } from "#/export.ts";

const taskA = Task.make("taskA", {
  grader: Grade.embed(
    Schema.Struct({ passed: Schema.Boolean }), //
    async () => ({ passed: true }),
  ),
}).pipe(
  Task.result(
    Schema.Struct({ passAt1: Schema.Number }), //
    async () => ({ passAt1: 1 }),
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
    async () => ({ total: 2 }),
  ),
);

const bench = Bench.make({ id: "bench" }, taskA, taskB)
  .pipe(
    Bench.result(
      Schema.Struct({ total: Schema.Number }), //
      async (tasks) => {
        return { total: 1 };
      },
    ),
  )
  .pipe(
    Bench.mapTask("taskA", (task) =>
      task.pipe(
        Task.result(
          Schema.Struct({ passAt2: Schema.Number }), //
          async () => ({ passAt2: 2 }),
        ),
      ),
    ),
  );
