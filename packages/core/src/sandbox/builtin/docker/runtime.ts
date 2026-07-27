import { Context, Effect, Option } from "effect";
import { Spawn } from "#/utils/export.ts";
import { ChildProcess as CP } from "effect/unstable/process";

export const runtimes = ["docker", "podman", "nerdctl"] as const;

export type Runtime = (command: CP.Command) => CP.Command;
export const Runtime = Context.Reference<Runtime>("Runtime", {
  defaultValue: () => CP.prefix("docker"),
});

export const make = Effect.fn(function* (): Effect.fn.Return<Runtime, unknown, Spawn.Service> {
  const spawner = yield* Spawn.Service;

  const whichs = yield* Effect.all(
    runtimes.map((runtime) =>
      spawner.string(CP.make`command -v ${runtime}`).pipe(
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

  return CP.prefix(found.value.trim());
});
