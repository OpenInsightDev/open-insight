import { NodeServices } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Spawn } from "@open-insight/core";
import { pathToFileURL } from "node:url";
import { ConfigProvider, Effect, FileSystem, Layer, Path, Sink, Stream } from "effect";
import { ChildProcess as CP, ChildProcessSpawner } from "effect/unstable/process";
import type * as Task from "#/task/index.ts";
import { TasksError } from "../error.ts";
import { withGitRepo, withGithub, withHuggingface } from "./index.ts";

const emptyTasks: ReadonlyArray<Task.AnyTask> = [];
const textEncoder = new TextEncoder();

const makeHandle = (stdout = "", stderr = "", exitCode = 0) => {
  const stdoutStream = stdout === "" ? Stream.empty : Stream.make(textEncoder.encode(stdout));
  const stderrStream = stderr === "" ? Stream.empty : Stream.make(textEncoder.encode(stderr));

  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    stdout: stdoutStream,
    stderr: stderrStream,
    all: Stream.concat(stdoutStream, stderrStream),
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
};

const makeRecordingSpawner = (
  respond: (command: CP.Command) => {
    readonly stdout?: string;
    readonly stderr?: string;
    readonly exitCode?: number;
  } = () => ({}),
) => {
  const commands: Array<CP.Command> = [];
  const service = ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      commands.push(command);
      const response = respond(command);
      return makeHandle(response.stdout, response.stderr, response.exitCode);
    }),
  );

  return {
    commands,
    layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, service),
  };
};

const commandParts = (command: CP.Command) => {
  assert.strictEqual(command._tag, "StandardCommand");
  if (command._tag !== "StandardCommand") {
    return [];
  }
  return [command.command, ...command.args];
};

const runRecorded =
  (recording: ReturnType<typeof makeRecordingSpawner>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provide(recording.layer), Effect.provide(NodeServices.layer));

describe("git task source commands", () => {
  it.effect.each([
    {
      name: "defaults to a depth-one clone",
      options: {},
      expected: ["git", "clone", "--depth", "1", "local-source", "/virtual/repo"],
    },
    {
      name: "uses an explicit depth",
      options: { depth: 4 },
      expected: ["git", "clone", "--depth", "4", "local-source", "/virtual/repo"],
    },
    {
      name: "supports a full clone",
      options: { depth: Number.POSITIVE_INFINITY },
      expected: ["git", "clone", "local-source", "/virtual/repo"],
    },
    {
      name: "defaults to a single branch when a branch is selected",
      options: { branch: "release" },
      expected: [
        "git",
        "clone",
        "--depth",
        "1",
        "--branch",
        "release",
        "--single-branch",
        "local-source",
        "/virtual/repo",
      ],
    },
    {
      name: "honors singleBranch false",
      options: { branch: "release", singleBranch: false },
      expected: [
        "git",
        "clone",
        "--depth",
        "1",
        "--branch",
        "release",
        "local-source",
        "/virtual/repo",
      ],
    },
    {
      name: "supports a full single-branch clone",
      options: { branch: "release", depth: Number.POSITIVE_INFINITY },
      expected: [
        "git",
        "clone",
        "--branch",
        "release",
        "--single-branch",
        "local-source",
        "/virtual/repo",
      ],
    },
  ])("$name", ({ options, expected }) => {
    const recording = makeRecordingSpawner();
    return withGitRepo("local-source", { directory: "/virtual/repo", ...options })(() =>
      Effect.succeed(emptyTasks),
    ).pipe(
      runRecorded(recording),
      Effect.tap(() =>
        Effect.sync(() => {
          assert.strictEqual(recording.commands.length, 1);
          assert.deepStrictEqual(commandParts(recording.commands[0]!), expected);
        }),
      ),
    );
  });

  it.effect("builds provider URLs without contacting the network", () => {
    const github = makeRecordingSpawner();
    const huggingface = makeRecordingSpawner();

    return Effect.gen(function* () {
      yield* withGithub("acme/project", { directory: "/virtual/github" })(() =>
        Effect.succeed(emptyTasks),
      ).pipe(runRecorded(github));
      yield* withHuggingface("acme/dataset", { directory: "/virtual/huggingface" })(() =>
        Effect.succeed(emptyTasks),
      ).pipe(runRecorded(huggingface));

      assert.deepStrictEqual(commandParts(github.commands[0]!).slice(-2), [
        "https://github.com/acme/project.git",
        "/virtual/github",
      ]);
      assert.deepStrictEqual(commandParts(huggingface.commands[0]!).slice(-2), [
        "https://huggingface.co/datasets/acme/dataset.git",
        "/virtual/huggingface",
      ]);
    });
  });

  it.effect("runs postInit in the repository and then invokes the loader once", () => {
    const recording = makeRecordingSpawner();
    let loaded = 0;

    return withGitRepo("local-source", {
      directory: "/virtual/repo",
      postInit: "prepare --local",
    })((repoPath) => {
      loaded += 1;
      assert.strictEqual(repoPath, "/virtual/repo");
      return Effect.succeed(emptyTasks);
    }).pipe(
      runRecorded(recording),
      Effect.tap(() =>
        Effect.sync(() => {
          assert.strictEqual(loaded, 1);
          assert.deepStrictEqual(commandParts(recording.commands[1]!), [
            "sh",
            "-c",
            "prepare --local",
          ]);
          const postInit = recording.commands[1];
          assert.strictEqual(postInit?._tag, "StandardCommand");
          if (postInit?._tag === "StandardCommand") {
            assert.strictEqual(postInit.options.cwd, "/virtual/repo");
          }
        }),
      ),
    );
  });

  it.effect("maps a clone failure to SourceNotAvailable and skips the loader", () => {
    const recording = makeRecordingSpawner(() => ({ stderr: "clone failed", exitCode: 1 }));
    let loaded = false;

    return Effect.gen(function* () {
      const error = yield* withGitRepo("local-source", { directory: "/virtual/repo" })(() => {
        loaded = true;
        return Effect.succeed(emptyTasks);
      }).pipe(runRecorded(recording), Effect.flip);

      assert.isFalse(loaded);
      assert.isTrue(error instanceof TasksError);
      if (error instanceof TasksError) {
        assert.strictEqual(error.reason._tag, "SourceNotAvailable");
      }
    });
  });

  it.effect("maps a postInit failure to SourceNotAvailable and skips the loader", () => {
    const recording = makeRecordingSpawner((command) =>
      command._tag === "StandardCommand" && command.command === "sh"
        ? { stderr: "post init failed", exitCode: 1 }
        : {},
    );
    let loaded = false;

    return Effect.gen(function* () {
      const error = yield* withGitRepo("local-source", {
        directory: "/virtual/repo",
        postInit: "exit 1",
      })(() => {
        loaded = true;
        return Effect.succeed(emptyTasks);
      }).pipe(runRecorded(recording), Effect.flip);

      assert.isFalse(loaded);
      assert.isTrue(error instanceof TasksError);
      if (error instanceof TasksError) {
        assert.strictEqual(error.reason._tag, "SourceNotAvailable");
      }
    });
  });

  it.effect("maps a synchronous loader exception to InitFailed", () => {
    const recording = makeRecordingSpawner();
    const throwingLoader = (): Effect.Effect<ReadonlyArray<Task.AnyTask>> => {
      throw new Error("loader exploded");
    };

    return Effect.gen(function* () {
      const error = yield* withGitRepo("local-source", { directory: "/virtual/repo" })(
        throwingLoader,
      ).pipe(runRecorded(recording), Effect.flip);

      assert.isTrue(error instanceof TasksError);
      if (error instanceof TasksError) {
        assert.strictEqual(error.reason._tag, "InitFailed");
      }
    });
  });

  it.effect("preserves failures from the returned loader Effect", () => {
    const recording = makeRecordingSpawner();

    return Effect.gen(function* () {
      const error = yield* withGitRepo("local-source", { directory: "/virtual/repo" })(() =>
        Effect.fail("loader failure" as const),
      ).pipe(runRecorded(recording), Effect.flip);
      assert.strictEqual(error, "loader failure");
    });
  });

  it.effect("does not mutate or delete a conflicting explicit directory", () => {
    const recording = makeRecordingSpawner(() => ({ stdout: "different-source\n" }));

    return Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "open-insight-git-safe-" });
        const directory = path.join(root, "caller-owned");
        const sentinel = path.join(directory, "keep.txt");
        yield* fs.makeDirectory(directory);
        yield* fs.writeFileString(sentinel, "must survive");

        const error = yield* withGitRepo("local-source", { directory })(() =>
          Effect.succeed(emptyTasks),
        ).pipe(runRecorded(recording), Effect.flip);

        assert.isTrue(error instanceof TasksError);
        if (error instanceof TasksError) {
          assert.strictEqual(error.reason._tag, "DirectoryConflict");
        }
        assert.strictEqual(yield* fs.readFileString(sentinel), "must survive");

        const commands = recording.commands.map(commandParts);
        assert.isFalse(commands.some((parts) => parts.includes("reset")));
        assert.isFalse(commands.some((parts) => parts.includes("clean")));
        assert.isFalse(commands.some((parts) => parts.includes("set-url")));
      }).pipe(Effect.provide(NodeServices.layer)),
    );
  });
});

const LiveTestLayer = Spawn.Service.layer.pipe(Layer.provideMerge(NodeServices.layer));

const isolateGitEnvironment = Effect.fn("test.isolateGitEnvironment")(function* (root: string) {
  const original = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith("GIT_")),
  );

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      for (const key of Object.keys(process.env)) {
        if (key.startsWith("GIT_")) {
          delete process.env[key];
        }
      }
      process.env.GIT_CONFIG_GLOBAL = `${root}/isolated.gitconfig`;
      process.env.GIT_CONFIG_NOSYSTEM = "1";
      process.env.GIT_TERMINAL_PROMPT = "0";
      process.env.GIT_ALLOW_PROTOCOL = "file";
      process.env.GIT_SSH_COMMAND = "false";
      process.env.GIT_AUTHOR_NAME = "Open Insight Test";
      process.env.GIT_AUTHOR_EMAIL = "test@example.invalid";
      process.env.GIT_COMMITTER_NAME = "Open Insight Test";
      process.env.GIT_COMMITTER_EMAIL = "test@example.invalid";
    }),
    () =>
      Effect.sync(() => {
        for (const key of Object.keys(process.env)) {
          if (key.startsWith("GIT_")) {
            delete process.env[key];
          }
        }
        Object.assign(process.env, original);
      }),
  );
});

const runGit = Effect.fn("test.runGit")(function* (args: ReadonlyArray<string>) {
  const spawner = yield* Spawn.Service;
  yield* spawner.success(CP.make("git", args));
});

const gitString = Effect.fn("test.gitString")(function* (args: ReadonlyArray<string>) {
  const spawner = yield* Spawn.Service;
  return (yield* spawner.string(CP.make("git", args))).trim();
});

const makeLocalRemote = Effect.fn("test.makeLocalRemote")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "open-insight-git-" });
  yield* isolateGitEnvironment(root);

  const work = path.join(root, "upstream worktree");
  const remote = path.join(root, "remote.git");
  yield* runGit(["init", "--bare", remote]);
  yield* runGit(["init", "--initial-branch", "main", work]);
  yield* fs.writeFileString(path.join(work, "data.txt"), "first\n");
  yield* runGit(["-C", work, "add", "data.txt"]);
  yield* runGit(["-C", work, "commit", "-m", "first"]);
  const firstCommit = yield* gitString(["-C", work, "rev-parse", "HEAD"]);
  yield* runGit(["-C", work, "remote", "add", "origin", remote]);
  yield* runGit(["-C", work, "push", "-u", "origin", "main"]);
  yield* runGit(["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);

  return { root, work, remote, firstCommit };
});

const pushCommit = Effect.fn("test.pushCommit")(function* (
  work: string,
  content: string,
  message: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.writeFileString(path.join(work, "data.txt"), content);
  yield* runGit(["-C", work, "add", "data.txt"]);
  yield* runGit(["-C", work, "commit", "-m", message]);
  yield* runGit(["-C", work, "push", "origin", "main"]);
  return yield* gitString(["-C", work, "rev-parse", "HEAD"]);
});

layer(LiveTestLayer)("git task source with an isolated local remote", (it) => {
  it.effect("clones a local repository and passes its exact path to the loader", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* makeLocalRemote();
        const directory = path.join(fixture.root, "target repo");
        let loadedPath: string | undefined;

        const tasks = yield* withGitRepo(fixture.remote, { directory })((repoPath) => {
          loadedPath = repoPath;
          return Effect.succeed(emptyTasks);
        });

        assert.strictEqual(tasks, emptyTasks);
        assert.strictEqual(loadedPath, directory);
        assert.strictEqual(yield* fs.readFileString(path.join(directory, "data.txt")), "first\n");
        assert.strictEqual(
          yield* gitString(["-C", directory, "rev-parse", "HEAD"]),
          fixture.firstCommit,
        );
      }),
    ),
  );

  it.effect("clones into an existing empty explicit directory", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* makeLocalRemote();
        const directory = path.join(fixture.root, "empty target");
        yield* fs.makeDirectory(directory);

        yield* withGitRepo(fixture.remote, { directory })(() => Effect.succeed(emptyTasks));

        assert.strictEqual(yield* fs.readFileString(path.join(directory, "data.txt")), "first\n");
      }),
    ),
  );

  it.effect("reuses a clean matching explicit repository without contacting its remote", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* makeLocalRemote();
        const directory = path.join(fixture.root, "reused");
        yield* withGitRepo(fixture.remote, { directory })(() => Effect.succeed(emptyTasks));

        yield* fs.rename(fixture.remote, path.join(fixture.root, "remote-unavailable.git"));
        yield* withGitRepo(fixture.remote, { directory })(() => Effect.succeed(emptyTasks));

        assert.strictEqual(
          yield* gitString(["-C", directory, "rev-parse", "HEAD"]),
          fixture.firstCommit,
        );
      }),
    ),
  );

  it.effect("checks out a requested branch commit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fixture = yield* makeLocalRemote();
        const directory = path.join(fixture.root, "pinned");

        yield* withGitRepo(fixture.remote, {
          directory,
          branch: "main",
          commit: fixture.firstCommit,
        })(() => Effect.succeed(emptyTasks));

        assert.strictEqual(
          yield* gitString(["-C", directory, "rev-parse", "HEAD"]),
          fixture.firstCommit,
        );
      }),
    ),
  );

  it.effect("fetches and checks out a historical commit missing from a shallow clone", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* makeLocalRemote();
        yield* pushCommit(fixture.work, "second\n", "second");
        const directory = path.join(fixture.root, "historical");

        yield* withGitRepo(pathToFileURL(fixture.remote).href, {
          directory,
          branch: "main",
          commit: fixture.firstCommit,
        })(() => Effect.succeed(emptyTasks));

        assert.strictEqual(
          yield* gitString(["-C", directory, "rev-parse", "HEAD"]),
          fixture.firstCommit,
        );
        assert.strictEqual(yield* fs.readFileString(path.join(directory, "data.txt")), "first\n");
      }),
    ),
  );

  it.effect("repairs a dirty managed cache and advances the selected branch", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* makeLocalRemote();
        const cacheRoot = path.join(fixture.root, "cache");
        const configLayer = ConfigProvider.layer(
          ConfigProvider.fromEnvRecord({ OPENINSIGHT_CACHE_DIR: cacheRoot }),
        );
        let cachedPath = "";

        const load = withGitRepo(fixture.remote, { branch: "main" })((repoPath) => {
          cachedPath = repoPath;
          return Effect.succeed(emptyTasks);
        }).pipe(Effect.provide(configLayer));

        yield* load;
        yield* fs.writeFileString(path.join(cachedPath, "data.txt"), "dirty\n");
        yield* fs.writeFileString(path.join(cachedPath, "untracked.txt"), "remove me\n");
        const latestCommit = yield* pushCommit(fixture.work, "second\n", "second");

        yield* load;

        assert.strictEqual(yield* gitString(["-C", cachedPath, "rev-parse", "HEAD"]), latestCommit);
        assert.strictEqual(yield* fs.readFileString(path.join(cachedPath, "data.txt")), "second\n");
        assert.isFalse(yield* fs.exists(path.join(cachedPath, "untracked.txt")));
      }),
    ),
  );

  it.effect("cleans up only an auto-created cache after its scope closes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* makeLocalRemote();
        const cacheRoot = path.join(fixture.root, "cleanup-cache");
        const configLayer = ConfigProvider.layer(
          ConfigProvider.fromEnvRecord({ OPENINSIGHT_CACHE_DIR: cacheRoot }),
        );
        let cachedPath = "";

        yield* Effect.scoped(
          withGitRepo(fixture.remote, { cleanup: true })((repoPath) => {
            cachedPath = repoPath;
            return Effect.succeed(emptyTasks);
          }).pipe(Effect.provide(configLayer)),
        );

        assert.isFalse(yield* fs.exists(cachedPath));
      }),
    ),
  );

  it.effect("ignores cleanup for an explicit directory", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* makeLocalRemote();
        const directory = path.join(fixture.root, "persistent");

        yield* Effect.scoped(
          withGitRepo(fixture.remote, { directory, cleanup: true })(() =>
            Effect.succeed(emptyTasks),
          ),
        );

        assert.isTrue(yield* fs.exists(directory));
        assert.strictEqual(yield* fs.readFileString(path.join(directory, "data.txt")), "first\n");
      }),
    ),
  );
});
