import { Snapshot } from "@open-insight/core/internal";
import * as Bench from "#/bench/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Task from "#/task/index.ts";
import * as Tasks from "#/tasks/index.ts";
import { Effect, Schema } from "effect";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Eval } from "../src/export.ts";

const GradeResult = Schema.Struct({ simPass: Schema.Boolean });

const makeTask = (id: string) =>
  Task.make({
    id,
    name: id,
    snapshot: Snapshot.make("test-image"),
  }).pipe(
    Task.stage("grade", {
      id: "grade",
      prompt: "Grade the task",
      grader: Grade.make(GradeResult)(async () => ({ simPass: true })),
    }),
  );

const makeBench = Effect.fn(function* () {
  return yield* Bench.make("id", Tasks.fromIter([makeTask("task1")])).pipe(Bench.head(1));
});

const main = Effect.gen(function* () {
  const result = yield* makeBench().pipe(Eval.run());
  console.log(result);
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(main);
