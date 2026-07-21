import * as Tasks from "#/tasks/index.ts";
import { Cause, Effect, FileSystem, Path } from "effect";

export type Options = Readonly<{}>;

export type Config = Readonly<{
  tasks: Tasks.Tasks;
}>;

export const ConfigPath = ".open-insight/ci.ts";

export const resolveConfig = Effect.fn(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  const configPath = path.resolve(process.cwd(), ConfigPath);
  const exists = yield* fs.exists(configPath);
  if (!exists) {
    return null;
  }

  const configModule = yield* Effect.tryPromise(() => import(configPath));
  const configFn = configModule.default as (
    options: Options,
  ) => Effect.Effect<Config, unknown, never>;

  const options = {} satisfies Options;
  return yield* configFn(options).pipe(
    Effect.mapError((cause) => new Cause.UnknownError(cause, "Failed to resolve config")),
  );
});
