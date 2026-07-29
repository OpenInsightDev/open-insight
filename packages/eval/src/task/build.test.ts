import { NodeCrypto } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import { Snapshot } from "@open-insight/core/internal";
import { Effect, Schema } from "effect";
import * as Task from "./index.ts";

class Extras extends Schema.Class<Extras>("TestTaskExtras")({
  owner: Schema.String,
  revision: Schema.NumberFromString,
}) {}

class Setup extends Schema.Class<Setup>("TestSetupGradeResult")({
  ready: Schema.Boolean,
}) {}

class Inspection extends Schema.Class<Inspection>("TestInspectionGradeResult")({
  clean: Schema.Boolean,
}) {}

class GradeResult extends Schema.Class<GradeResult>("TestFinalGradeResult")({
  passed: Schema.Boolean,
}) {}

const template = Task.Template.make({
  extras: Extras,
  grade: GradeResult,
});

const values = {
  id: "schema-task",
  name: "Schema task",
  snapshot: Snapshot.make("test-image"),
  extras: { owner: "eval", revision: "1" },
};

const task = Task.make(template, values).pipe(
  Task.stage("setup", {
    schema: Setup,
    prompt: "Prepare the task",
    grader: async () => ({ ready: true }),
  }),
  Task.stage("solve", {
    schema: GradeResult,
    prompt: "Solve the task",
    grader: async ({ results }) => ({ passed: results.setup.ready }),
  }),
  Task.build,
);

it.effect("keeps template schemas separate from task values", () =>
  Effect.gen(function* () {
    const built = yield* task;

    assert.strictEqual(built.template.extras, Extras);
    assert.strictEqual(built.template.grade, GradeResult);
    assert.deepStrictEqual(Schema.encodeSync(built.template.extras)(built.extras), {
      owner: "eval",
      revision: "1",
    });
    assert.strictEqual(built.stages[0]?.grader.schema, Setup);
    assert.strictEqual(built.stages[1]?.grader.schema, GradeResult);

    const metadata = Task.metadata(built);
    assert.deepStrictEqual(metadata.extras, { owner: "eval", revision: "1" });
    const encodedMetadata = Schema.encodeSync(Task.metadataSchema(built))(metadata);
    assert.deepStrictEqual(encodedMetadata.extras, { owner: "eval", revision: "1" });
  }).pipe(Effect.provide(NodeCrypto.layer)),
);

it.effect("allows task-local intermediate stages and infers every preceding result", () =>
  Effect.gen(function* () {
    const task = yield* Task.make(template, values).pipe(
      Task.stage("setup", {
        schema: Setup,
        prompt: "Prepare the task",
        grader: async () => ({ ready: true }),
      }),
      Task.stage("inspect", {
        schema: Inspection,
        prompt: "Inspect the task",
        grader: async ({ results }) => ({ clean: results.setup.ready }),
      }),
      Task.stage("solve", {
        schema: GradeResult,
        prompt: "Solve the task",
        grader: async ({ results }) => ({
          passed: results.setup.ready && results.inspect.clean,
        }),
      }),
      Task.build,
    );
    assert.deepStrictEqual(
      task.stages.map((stage) => stage.metadata.name),
      ["setup", "inspect", "solve"],
    );
  }).pipe(Effect.provide(NodeCrypto.layer)),
);

it("enforces template conformance entirely at the type level", () => {
  const wrongFinalGrade = Task.make(template, values).pipe(
    Task.stage("setup", {
      schema: Setup,
      prompt: "Prepare the task",
      grader: async () => ({ ready: true }),
    }),
  );
  // @ts-expect-error The final stage result must satisfy the template grade.
  Task.build(wrongFinalGrade);

  // @ts-expect-error Extras use the encoded shape of the template schema.
  Task.make(template, { ...values, extras: { owner: 1, revision: "1" } });

  assert.isTrue(true);
});
