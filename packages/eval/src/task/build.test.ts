import { NodeCrypto } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import { Snapshot } from "@open-insight/core/internal";
import { Effect, Schema } from "effect";
import * as Grade from "#/grade/index.ts";
import * as Task from "./index.ts";

class Extras extends Schema.Class<Extras>("TestTaskExtras")({
  owner: Schema.String,
  revision: Schema.NumberFromString,
}) {}

class Setup extends Schema.Class<Setup>("TestSetupGradeResult")({
  ready: Schema.Boolean,
}) {}

class GradeResult extends Schema.Class<GradeResult>("TestFinalGradeResult")({
  passed: Schema.Boolean,
}) {}

type SetupStage = Task.Stage<"setup", Setup>;

const solveGrader = Grade.make<typeof GradeResult, Readonly<{ setup: Setup }>>(
  GradeResult,
  async ({ results }) => ({
    passed: results.setup.ready,
  }),
);

it.effect("stores and reuses task schemas for serialization", () =>
  Effect.gen(function* () {
    const taskEffect = Task.make({
      id: "schema-task",
      name: "Schema task",
      snapshot: Snapshot.make("test-image"),
      extras: { schema: Extras, value: { owner: "eval", revision: "1" } },
    });
    const task = yield* taskEffect;

    assert.strictEqual(task.schema.extras, Extras);
    assert.isNull(task.schema.grade);
    assert.deepStrictEqual(Schema.encodeSync(task.schema.extras)(task.extras), {
      owner: "eval",
      revision: "1",
    });

    const staged = yield* taskEffect.pipe(
      Task.stage<"setup", Setup, never>("setup", {
        prompt: "Prepare the task",
        grader: Grade.make(Setup, async () => ({ ready: true })),
      }),
      Task.stage<"solve", GradeResult, SetupStage>("solve", {
        prompt: "Solve the task",
        grader: solveGrader,
      }),
    );

    assert.strictEqual(staged.schema.extras, Extras);
    assert.strictEqual(staged.schema.grade, GradeResult);
    assert.strictEqual(staged.stages[0]?.grader.schema, Setup);
    assert.strictEqual(staged.stages[1]?.grader.schema, GradeResult);
    assert.deepStrictEqual(
      Schema.encodeSync(GradeResult)(Schema.decodeSync(GradeResult)({ passed: true })),
      { passed: true },
    );

    const metadata = Task.metadata(staged);
    assert.deepStrictEqual(metadata.extras, { owner: "eval", revision: "1" });
    const encodedMetadata = Schema.encodeSync(Task.metadataSchema(staged))(metadata);
    assert.deepStrictEqual(encodedMetadata.extras, { owner: "eval", revision: "1" });
  }).pipe(Effect.provide(NodeCrypto.layer)),
);
