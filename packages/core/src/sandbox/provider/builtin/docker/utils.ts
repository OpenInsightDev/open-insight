import { Effect, Option } from "effect";
import { Spawn } from "@open-insight/utils";
import { ChildProcess } from "effect/unstable/process";

export type Runtime = (self: ChildProcess.Command) => ChildProcess.Command;

export const makeRuntime = Effect.fn("sandbox/docker/makeRuntime")(function* () {
  // docker-compatible clis
  const runtimes = ["docker", "podman", "nerdctl"] as const;
  const spawner = yield* Spawn.SpawnService;

  const whichs = yield* Effect.all(
    runtimes.map((runtime) =>
      spawner.string(ChildProcess.make`command -v ${runtime}`).pipe(
        Effect.map(Option.some),
        Effect.catchIf(
          (error: unknown): error is { reason: { _tag: string } } =>
            Boolean(error && typeof error === "object" && "reason" in error),
          () => Effect.succeed(Option.none<string>()),
        ),
      ),
    ),
    { concurrency: "unbounded" },
  );

  const found = whichs.find((o): o is Option.Some<string> => Option.isSome(o));
  if (found === undefined) {
    return yield* Effect.fail(new Error("No container runtime found."));
  }

  return ChildProcess.prefix(found.value.trim()) satisfies Runtime;
});
