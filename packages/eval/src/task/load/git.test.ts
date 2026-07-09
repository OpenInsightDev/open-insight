import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { Spawn } from "@open-insight/core/utils";
import { withGitRepo } from "./git.ts";

const testLayer = Layer.merge(
  NodeServices.layer,
  Spawn.Service.layer.pipe(Layer.provide(NodeServices.layer)),
);

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* Spawn.Service;
    return yield* spawner
      .string(ChildProcess.make("git", ["-C", cwd, ...args]))
      .pipe(Effect.map((s) => s.trim()));
  });

const runGit = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* Spawn.Service;
    yield* spawner.exitCode(ChildProcess.make("git", ["-C", cwd, ...args]));
  });

const initRemote = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "open-insight-git-test-" });
  const remote = `${root}/remote.git`;
  const work = `${root}/work`;
  const target = `${root}/target`;

  yield* fs.makeDirectory(work);

  const spawner = yield* Spawn.Service;
  yield* spawner.exitCode(ChildProcess.make("git", ["init", "--bare", "-b", "main", remote]));
  yield* runGit(work, ["init", "-b", "main"]);
  yield* runGit(work, ["config", "user.email", "test@example.com"]);
  yield* runGit(work, ["config", "user.name", "Test User"]);
  yield* runGit(work, ["remote", "add", "origin", remote]);

  const commit = (name: string, body: string) =>
    Effect.gen(function* () {
      yield* fs.writeFileString(`${work}/file.txt`, body);
      yield* runGit(work, ["add", "file.txt"]);
      yield* runGit(work, ["commit", "-m", name]);
      return yield* git(work, ["rev-parse", "HEAD"]);
    });

  const first = yield* commit("first", "first\n");
  yield* runGit(work, ["tag", "v1"]);
  yield* runGit(work, ["checkout", "-b", "feature"]);
  const feature = yield* commit("feature", "feature\n");
  yield* runGit(work, ["push", "--all", "origin"]);
  yield* runGit(work, ["push", "--tags", "origin"]);
  yield* runGit(work, ["checkout", "main"]);
  const main = yield* commit("main", "main\n");
  yield* runGit(work, ["push", "origin", "main"]);

  return { remote, target, first, feature, main };
});

const loadRepo = (repoURL: string, directory: string, options = {}) =>
  withGitRepo(repoURL, { directory, ...options })(() => Effect.succeed([]));

const assertRepo = (
  directory: string,
  expected: {
    readonly remote: string;
    readonly commit: string;
    readonly status?: string;
  },
) =>
  Effect.gen(function* () {
    assert.strictEqual(yield* git(directory, ["remote", "get-url", "origin"]), expected.remote);
    assert.strictEqual(yield* git(directory, ["rev-parse", "HEAD"]), expected.commit);
    assert.strictEqual(yield* git(directory, ["status", "--porcelain"]), expected.status ?? "");
  });

describe("withGitRepo", () => {
  layer(testLayer)((it) => {
    it.effect("clones into a missing target directory", () =>
      Effect.gen(function* () {
        const { remote, target, main } = yield* initRemote;

        yield* loadRepo(remote, target);

        yield* assertRepo(target, { remote, commit: main });
      }),
    );

    it.effect("returns successfully when the target directory already matches", () =>
      Effect.gen(function* () {
        const { remote, target, main } = yield* initRemote;

        yield* loadRepo(remote, target);
        const gitDir = yield* git(target, ["rev-parse", "--git-dir"]);

        yield* loadRepo(remote, target);

        assert.strictEqual(yield* git(target, ["rev-parse", "--git-dir"]), gitDir);
        yield* assertRepo(target, { remote, commit: main });
      }),
    );

    it.effect("updates an existing repo to the requested branch", () =>
      Effect.gen(function* () {
        const { remote, target, feature } = yield* initRemote;

        yield* loadRepo(remote, target);
        yield* loadRepo(remote, target, { branch: "feature" });

        assert.strictEqual(yield* git(target, ["rev-parse", "--abbrev-ref", "HEAD"]), "feature");
        yield* assertRepo(target, { remote, commit: feature });
      }),
    );

    it.effect("cleans local changes while updating an existing repo", () =>
      Effect.gen(function* () {
        const { remote, target, feature } = yield* initRemote;
        const fs = yield* FileSystem.FileSystem;

        yield* loadRepo(remote, target);
        yield* fs.writeFileString(`${target}/file.txt`, "dirty\n");
        yield* fs.writeFileString(`${target}/extra.txt`, "extra\n");

        yield* loadRepo(remote, target, { branch: "feature" });

        yield* assertRepo(target, { remote, commit: feature });
        assert.strictEqual(yield* fs.exists(`${target}/extra.txt`), false);
      }),
    );

    it.effect("checks out a requested commit after cloning or updating", () =>
      Effect.gen(function* () {
        const { remote, target, first } = yield* initRemote;

        yield* loadRepo(remote, target, { commit: first });

        assert.strictEqual(yield* git(target, ["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD");
        yield* assertRepo(target, { remote, commit: first });
      }),
    );

    it.effect("keeps branch plus commit targets on the requested commit", () =>
      Effect.gen(function* () {
        const { remote, target, first } = yield* initRemote;

        yield* loadRepo(remote, target, { branch: "main", commit: first });
        yield* loadRepo(remote, target, { branch: "main", commit: first });

        assert.strictEqual(yield* git(target, ["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD");
        yield* assertRepo(target, { remote, commit: first });
      }),
    );

    it.effect("treats branch option as a tag name when git does", () =>
      Effect.gen(function* () {
        const { remote, target, first } = yield* initRemote;

        yield* loadRepo(remote, target, { branch: "v1" });

        assert.strictEqual(yield* git(target, ["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD");
        yield* assertRepo(target, { remote, commit: first });
      }),
    );

    it.effect("reclones when the existing target is not a git repository", () =>
      Effect.gen(function* () {
        const { remote, target, main } = yield* initRemote;
        const fs = yield* FileSystem.FileSystem;

        yield* fs.makeDirectory(target);
        yield* fs.writeFileString(`${target}/junk.txt`, "junk\n");
        yield* loadRepo(remote, target);

        yield* assertRepo(target, { remote, commit: main });
        assert.strictEqual(yield* fs.exists(`${target}/junk.txt`), false);
      }),
    );

    it.effect("reclones when an existing repo cannot reach the requested commit", () =>
      Effect.gen(function* () {
        const first = yield* initRemote;
        const second = yield* initRemote;

        yield* loadRepo(first.remote, first.target);
        yield* loadRepo(second.remote, first.target, { commit: second.main });

        yield* assertRepo(first.target, { remote: second.remote, commit: second.main });
      }),
    );

    it.effect("ignores temporary cleanup errors when clone fails", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "open-insight-git-test-" });

        const error = yield* withGitRepo(`${root}/missing.git`)(() => Effect.succeed([])).pipe(
          Effect.flip,
        );

        assert.strictEqual(error._tag, "TaskError");
        assert.strictEqual(error.reason._tag, "TaskLoadError");
      }),
    );
  });
});
