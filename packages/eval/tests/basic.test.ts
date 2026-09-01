import { Effect, Schema } from "effect";
import { Task, Bench, Grade } from "#/export.ts";
import { Tool, Toolkit } from "effect/unstable/ai";

const main = Effect.fn(function* () {
  const taskA = Task.make("taskA", {
    prompt: [{ role: "user", content: "Hello, world!" }],
    grader: Grade.embed(
      Schema.Struct({ passed: Schema.Boolean }), //
      Effect.fn(function* () {
        return { passed: true };
      }),
    ),
  }).pipe(
    Task.result(
      Schema.Struct({ passAt1: Schema.Number }), //
      () => Effect.succeed({ passAt1: 1 }),
    ),
    Task.mapGrade((prev) =>
      Grade.embed(
        prev.schema.mapFields((fields) => ({
          ...fields,
          count: Schema.Number,
        })),
        () => Effect.succeed({ passed: true, count: 1 }),
      ),
    ),
    Task.toolkit(Toolkit.make(Tool.make("toolA", {}))),
  );

  const taskB = Task.make("taskB", {
    prompt: [],
    grader: Grade.embed(
      Schema.Struct({ count: Schema.Number }), //
      () => Effect.succeed({ count: 1 }),
    ),
  }).pipe(
    Task.result(
      Schema.Struct({ total: Schema.Number }), //
      () => Effect.succeed({ total: 2 }),
    ),
    Task.extra(
      Schema.Struct({ category: Schema.String }), //
      { category: "test" },
    ),
  );

  const bench = Bench.make("bench", {}, taskA, taskB).pipe(
    Bench.mapTask("taskA", (task) =>
      task.pipe(
        Task.result(
          Schema.Struct({ passAt2: Schema.Number }), //
          () => Effect.succeed({ passAt2: 2 }),
        ),
      ),
    ),
    Bench.result(
      Schema.Struct({ total: Schema.Number }), //
      ({ taskA }) => {
        return Effect.succeed({ total: 1 });
      },
    ),
  );
});
