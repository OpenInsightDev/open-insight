import type { TrailID } from "#/event/index.ts";
import { Effect, FileSystem, Path } from "effect";
import * as Cache from "#/cache/index.ts";

export const trailCache = Effect.fn(function* ({ evalID, taskID, trailIdx }: TrailID) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const cacheDir = yield* Cache.ensureDir(evalID);
  const file = path.join(cacheDir, `${taskID}-${trailIdx}.jsonl`);

  const exists = yield* fs.exists(file);
  return { file, exists };
});
