import { Effect, FileSystem, Path } from "effect";
import * as Context from "../context/index.ts";
import { decode } from "./decode.ts";

export const fromContainerfile = Effect.fn(function* ({
  context,
  filePath,
}: {
  context: Context.Context;
  filePath: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const containerfilePath = path.join(context, filePath);

  const content = yield* fs.readFileString(containerfilePath);
  return yield* decode(content);
});
