import { NodeCrypto } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import { Snapshot } from "@open-insight/core/internal";
import { Effect, Schema } from "effect";
import * as Task from "./index.ts";

const Setup = {
  ready: Schema.Boolean,
};

const Inspection = {
  clean: Schema.Boolean,
};

const template = Task.Template.make({
  Extras: {
    owner: Schema.String,
    revision: Schema.NumberFromString,
  },
  Grade: {
    passed: Schema.Boolean,
  },
});

const values = {
  id: "schema-task",
  name: "Schema task",
  snapshot: Snapshot.make("test-image"),
  extras: { owner: "eval", revision: "1" },
};

const task = Task.make(template)(values).pipe(
  Task.stage("setup", {
    schema: Setup,
    prompt: "Prepare the task",
    grader: async () => ({ ready: true }),
  }),
  Task.stage("solve", {
    schema: template.Grade.fields,
    prompt: "Solve the task",
    grader: async ({ results }) => ({ passed: results.setup.ready }),
  }),
  Task.build,
);

it.effect("keeps template schemas separate from task values", () =>
  Effect.gen(function* () {
    const built = yield* task;

    assert.strictEqual(built.template, template);
    assert.deepStrictEqual(Schema.encodeSync(built.template.Extras)(built.extras), {
      owner: "eval",
      revision: "1",
    });
    const setupStage = built.stages[0];
    if (setupStage === undefined) {
      return assert.fail("Missing setup stage");
    }
    assert.deepStrictEqual(Schema.encodeSync(setupStage.grader.schema)({ ready: true }), {
      ready: true,
    });
    const finalStage = built.stages[1];
    if (finalStage === undefined) {
      return assert.fail("Missing final stage");
    }
    assert.notStrictEqual(finalStage.grader.schema, template.Grade);
    assert.deepStrictEqual(Schema.encodeSync(finalStage.grader.schema)({ passed: true }), {
      passed: true,
    });

    const metadata = Task.metadata(built);
    assert.deepStrictEqual(metadata.extras, { owner: "eval", revision: "1" });
    const encodedMetadata = Schema.encodeSync(Task.metadataSchema(built))(metadata);
    assert.deepStrictEqual(encodedMetadata.extras, { owner: "eval", revision: "1" });
  }).pipe(Effect.provide(NodeCrypto.layer)),
);

it.effect("allows task-local intermediate stages and infers every preceding result", () =>
  Effect.gen(function* () {
    const task = yield* Task.make(template)(values).pipe(
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
        schema: template.Grade.fields,
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
  const wrongFinalGrade = Task.make(template)(values).pipe(
    Task.stage("setup", {
      schema: Setup,
      prompt: "Prepare the task",
      grader: async () => ({ ready: true }),
    }),
  );
  // @ts-expect-error The final stage result must satisfy the template grade.
  Task.build(wrongFinalGrade);

  // @ts-expect-error Extras use the encoded shape of the template schema.
  Task.make(template)({ ...values, extras: { owner: 1, revision: "1" } });

  assert.isTrue(true);
});
