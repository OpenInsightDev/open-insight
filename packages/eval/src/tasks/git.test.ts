import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Spawn } from "@open-insight/core/utils";
import { Effect, FileSystem, Layer } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import path from "node:path";
import { Error } from "./error.ts";
import { withGitRepo } from "./git.ts";

const testLayer = Layer.merge(
  NodeServices.layer,
  Spawn.Service.layer.pipe(Layer.provide(NodeServices.layer)),
);

const makeRepository = Effect.fn(function* () {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* Spawn.Service;
  const root = yield* fs.makeTempDirectoryScoped();
  const source = path.join(root, "source");
  const target = path.join(root, "target");

  yield* spawner.success(CP.make`git init ${source}`);
  yield* fs.writeFileString(path.join(source, "README.md"), "fixture\n");
  yield* spawner.success(CP.make`git -C ${source} add README.md`);
  yield* spawner.success(
    CP.make`git -C ${source} -c user.name=Test -c user.email=test@example.com commit -m init`,
  );

  return { source, target };
});

describe("withGitRepo postInit", () => {
  layer(testLayer)((it) => {
    it.effect("runs the script from the prepared repository before loading tasks", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { source, target } = yield* makeRepository();
        const expectedWorkingDirectory = path.join(
          yield* fs.realPath(path.dirname(target)),
          "target",
        );
        const load = withGitRepo(source, {
          directory: target,
          postInit: 'printf "%s" "$PWD" > post-init.txt',
        });

        const tasks = yield* load((repoPath) =>
          fs.readFileString(path.join(repoPath, "post-init.txt")).pipe(
            Effect.orDie,
            Effect.tap((workingDirectory) =>
              Effect.sync(() => assert.strictEqual(workingDirectory, expectedWorkingDirectory)),
            ),
            Effect.as([]),
          ),
        );

        assert.deepStrictEqual(tasks, []);
      }),
    );

    it.effect("reports a failing script as a source error without calling the loader", () =>
      Effect.gen(function* () {
        const { source, target } = yield* makeRepository();
        let loaderCalled = false;
        const load = withGitRepo(source, {
          directory: target,
          postInit: "exit 7",
        });

        const error = yield* load(() => {
          loaderCalled = true;
          return Effect.succeed([]);
        }).pipe(Effect.flip);

        assert.isFalse(loaderCalled);
        assert.instanceOf(error, Error);
        assert.strictEqual(error.reason._tag, "SourceError");
      }),
    );
  });
});
