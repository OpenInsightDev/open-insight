import { Brand, Effect, FileSystem, Path, Schema } from "effect";
import { SandboxError } from "./error.ts";

export const ContextSchema = Schema.String;
export type Context = Schema.Schema.Type<typeof ContextSchema> & Brand.Brand<"Context">;

const makeContext = Brand.nominal<Context>();

export const make = Effect.fn(function* (
  dir: string,
): Effect.fn.Return<Context, SandboxError, Path.Path | FileSystem.FileSystem> {
  if (!dir.startsWith("/")) {
    yield* Effect.fail(SandboxError.context(new Error(`Not an absolute path: ${dir}`)));
  }

  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  const resolved = yield* Effect.try({
    try: () => path.resolve(dir),
    catch: (cause) => SandboxError.context(cause),
  });

  const stat = yield* fs.stat(resolved).pipe(Effect.mapError(SandboxError.context));

  if (stat.type !== "Directory") {
    yield* Effect.fail(SandboxError.context(new Error(`Not a directory: ${resolved}`)));
  }

  return makeContext(resolved);
});
