import { Spawn } from "@open-insight/core/utils";
import { Effect } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { Error } from "../error.ts";

export interface DownloadOptions {
  /** Harbor executable name or absolute path. Defaults to `harbor`. */
  readonly binary?: string;
  /** Replace an existing exported package. */
  readonly overwrite?: boolean;
}

export const download = Effect.fn("Task.Load.downloadHarborPackage")(function* (
  reference: string,
  outputDir: string,
  { binary = "harbor", overwrite = false }: DownloadOptions = {},
) {
  const spawner = yield* Spawn.Service;
  const args = ["download", reference, "--export", "--output-dir", outputDir];
  if (overwrite) {
    args.push("--overwrite");
  }
  yield* spawner.success(CP.make(binary, args)).pipe(Effect.mapError(Error.source));
});
