import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import { fileURLToPath } from "node:url";
import * as factoryFixture from "./__fixtures__/file-loader/factory/index.ts";
import { TaskError } from "../error.ts";
import { fromDir } from "./file.ts";

const fixtureDir = (name: string) =>
  fileURLToPath(new URL(`./__fixtures__/file-loader/${name}`, import.meta.url));

const loadErrorMessage = (error: unknown): string => {
  if (!(error instanceof TaskError)) {
    assert.fail(`Expected TaskError, got ${String(error)}`);
  }
  assert.strictEqual(error.reason._tag, "TaskLoadError");
  return String(error.reason.cause);
};

describe("fromDir", () => {
  layer(NodeServices.layer)((it) => {
    it.effect("discovers matching task modules recursively", () =>
      Effect.gen(function* () {
        const tasks = yield* fromDir({
          dir: fixtureDir("matching"),
          glob: "**/*.ts",
        });

        const loadedTasks = yield* Effect.all(tasks);

        assert.sameMembers(
          loadedTasks.map((task) => task.name),
          ["matching task", "nested matching task"],
        );
      }),
    );

    it.effect("matches entries relative to the source directory", () =>
      Effect.gen(function* () {
        const tasks = yield* fromDir({
          dir: fixtureDir("matching"),
          glob: "nested/*.ts",
        });

        const loadedTasks = yield* Effect.all(tasks);

        assert.deepStrictEqual(
          loadedTasks.map((task) => task.name),
          ["nested matching task"],
        );
      }),
    );

    it.effect("does not import entries that do not match the glob", () =>
      Effect.gen(function* () {
        const tasks = yield* fromDir({
          dir: fixtureDir("ignored"),
          glob: "**/index.ts",
        });

        assert.deepStrictEqual(tasks, []);
      }),
    );

    it.effect("wraps default task factories as scoped async disposable tasks", () =>
      Effect.gen(function* () {
        factoryFixture.reset();

        const tasks = yield* fromDir({
          dir: fixtureDir("factory"),
        });

        assert.strictEqual(factoryFixture.calls, 0);

        const loadedTasks = yield* Effect.scoped(Effect.all(tasks));

        assert.deepStrictEqual(
          loadedTasks.map((task) => task.name),
          ["factory task"],
        );
        assert.strictEqual(factoryFixture.calls, 1);
        assert.strictEqual(factoryFixture.disposed, 1);
      }),
    );

    it.effect("fails when a matching module has no default export", () =>
      Effect.gen(function* () {
        const exit = yield* fromDir({
          dir: fixtureDir("missing-default"),
        }).pipe(Effect.exit);

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isSuccess(exit)) {
          assert.fail("Expected loading task module to fail");
        }
        assert.include(loadErrorMessage(Cause.squash(exit.cause)), "requires a default export");
      }),
    );

    it.effect("fails when the default export is not a Task", () =>
      Effect.gen(function* () {
        const exit = yield* fromDir({
          dir: fixtureDir("invalid-default"),
        }).pipe(Effect.exit);

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isSuccess(exit)) {
          assert.fail("Expected loading task module to fail");
        }
        assert.include(
          loadErrorMessage(Cause.squash(exit.cause)),
          "exports a value that is not a valid Task",
        );
      }),
    );
  });
});
