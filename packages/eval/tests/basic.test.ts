import { Effect, Schema } from "effect";
import { Task, Bench, Grade } from "#/export.ts";

const main = Effect.fn(function* () {
  const taskA = yield* Task.make("taskA", {
    prompt: [{ role: "user", content: "Hello, world!" }],
    grader: yield* Grade.embed(
      Schema.Struct({ passed: Schema.Boolean }), //
      () => Effect.succeed({ passed: true }),
    ),
  }).pipe(
    Effect.flatMap(
      Task.result(
        Schema.Struct({ passAt1: Schema.Number }), //
        () => Effect.succeed({ passAt1: 1 }),
      ),
    ),
    Effect.map(
      Task.mapGrade((prev) =>
        Grade.embed(
          prev.schema.mapFields((fields) => ({
            ...fields,
            count: Schema.Number,
          })),
          async () => ({
            passed: true,
            count: 1,
          }),
        ),
      ),
    ),

    // Task.toolkit(
    //   Toolkit.make(
    //     Tool.make("toolA", {}), //
    //   ),
    // ),
  );

  const taskB = Task.make("taskB", {
    prompt: [],
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
});
