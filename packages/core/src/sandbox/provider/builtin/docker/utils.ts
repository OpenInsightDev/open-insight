import { Effect, Option } from "effect";
import { Spawn } from "@/utils/index.ts";
import { ChildProcess } from "effect/unstable/process";

export const makeRuntime = Effect.fn(function* () {
  // docker-compatible cli
  const runtimes = ["docker", "podman", "nerdctl"] as const;

  const spawner = yield* Spawn.SpawnService;

  const whichs = yield* Effect.all(
    runtimes.map((runtime) =>
      spawner.string(ChildProcess.make`command -v ${runtime}`).pipe(
        Effect.map(Option.some),
        Effect.catch(() => Effect.succeed(Option.none())),
      ),
    ),
    { concurrency: "unbounded" },
  );

  const found = whichs.find((runtime): runtime is Option.Some<string> => Option.isSome(runtime));
  if (found === undefined) {
    return yield* Effect.fail(
      new Error(
        `No docker-compatible runtime found. Please install one of the following: ${runtimes.join(", ")}`,
      ),
    );
  }

  return ChildProcess.prefix(found.value.trim());
});
