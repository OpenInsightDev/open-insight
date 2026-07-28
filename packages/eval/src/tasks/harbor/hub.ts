import { Spawn } from "@open-insight/core/utils";
import { Effect, FileSystem } from "effect";
import { type DownloadOptions, download } from "./cli.ts";
import { fromDir } from "./local.ts";

/** Downloads a Harbor registry task or dataset with the Harbor CLI, then loads its tasks. */
export const fromHub = Effect.fn("Task.Load.fromHarborHub")(
  function* (reference: string, options: DownloadOptions = {}) {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped({
      prefix: "open-insight-harbor-hub-",
    });
    yield* download(reference, dir, options);
    return yield* fromDir(dir);
  },
  (effect) => effect.pipe(Effect.provide(Spawn.Service.layer)),
);
