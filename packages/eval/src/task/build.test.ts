import { NodeCrypto } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import { Snapshot } from "@open-insight/core/internal";
import { Effect, Schema } from "effect";
import * as Grade from "#/grade/index.ts";
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
  Task.stage(Schema.Struct(Setup))("setup", {
    prompt: "Prepare the task",
    grader: Grade.make(async () => ({ ready: true })),
  }),
  Task.endStage("solve", {
    prompt: "Solve the task",
    grader: Grade.make(async ({ results }) => ({ passed: results.setup.ready })),
  }),
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
    assert.strictEqual(finalStage.grader.schema, template.Grade);
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
      Task.stage(Schema.Struct(Setup))("setup", {
        prompt: "Prepare the task",
        grader: Grade.make(async () => ({ ready: true })),
      }),
      Task.stage(Schema.Struct(Inspection))("inspect", {
        prompt: "Inspect the task",
        grader: Grade.make(async ({ results }) => ({
          clean: results.setup.ready,
        })),
      }),
      Task.endStage("solve", {
        prompt: "Solve the task",
        grader: Grade.make(async ({ results }) => ({
          passed: results.setup.ready && results.inspect.clean,
        })),
      }),
    );
    assert.deepStrictEqual(
      task.stages.map((stage) => stage.metadata.name),
      ["setup", "inspect", "solve"],
    );
  }).pipe(Effect.provide(NodeCrypto.layer)),
);

it("enforces template conformance entirely at the type level", () => {
  const unfinished = Task.make(template)(values).pipe(
    Task.stage(Schema.Struct(Setup))("setup", {
      prompt: "Prepare the task",
      grader: Grade.make(async () => ({ ready: true })),
    }),
  );
  // @ts-expect-error A builder is not a completed task until endStage is applied.
  const task: Task.Task = unfinished;

  // @ts-expect-error Extras use the encoded shape of the template schema.
  Task.make(template)({ ...values, extras: { owner: 1, revision: "1" } });

  Task.endStage("invalid-verifier", {
    prompt: "Invalid verifier",
    grader: {
      grade: async () => ({ passed: true }),
      // @ts-expect-error A verifier and its expected result must be defined together.
      verif: { run: async () => null },
    },
  });

  Task.make(template)(values).pipe(
    Task.endStage("invalid-grade", {
      prompt: "Invalid grade",
      // @ts-expect-error The grade result is checked against the template schema.
      grader: Grade.make(async () => ({ passed: "yes" })),
    }),
  );

  Task.make(template)(values).pipe(
    Task.endStage("invalid-expect", {
      prompt: "Invalid expected result",
      grader: Grade.make(async () => ({ passed: true }), {
        verif: async () => null,
        // @ts-expect-error The expected result is checked against the template schema.
        expect: { passed: "yes" },
      }),
    }),
  );

  assert.isTrue(true);
  assert.isDefined(task);
});
