import * as Task from "../index.ts";
import { ChildProcess } from "effect/unstable/process";
import { Effect, FileSystem } from "effect";
import { Spawn } from "@open-insight/utils";
import type { Loader } from "./index.ts";

export const withGitRepo = (repoURL: string) =>
  Effect.fn(function* <T extends Task.Task>(exec: (repoPath: string) => Loader<T>) {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* Spawn.SpawnService;

    const repoPath = yield* fs.makeTempDirectoryScoped({
      prefix: "open-insight-task-",
    });
    const clone = ChildProcess.make`git clone --depth 1 ${repoURL} ${repoPath}`;
    yield* spawner.exitCode(clone);

    return yield* exec(repoPath);
  });
