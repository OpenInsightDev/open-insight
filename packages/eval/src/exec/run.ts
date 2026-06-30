import { Effect, Scope } from "effect";
import { type Executor } from "./build.ts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { ExecError } from "./error.ts";
import { type Config } from "./config.ts";
import type * as _Core from "@open-insight/core";
import { run as runSchedule } from "./schedule.ts";

export const run = Effect.fn(
  function* <E, R>(
    executor: Effect.Effect<Executor, E, R>,
    config: Config = {},
  ): Effect.fn.Return<void, E | ExecError, R> {
    yield* Effect.map(executor, (exec) => runSchedule({ executor: exec, config }));
  },
  (effect) =>
    effect.pipe(
      Effect.provide(NodeServices.layer),
      Effect.provide(NodeHttpClient.layerUndici),
      Effect.scoped,
    ),
);

export const runPromise = async <E>(
  executor: Effect.Effect<Executor, E, Scope.Scope>,
  config?: Config,
) => Effect.runPromise(run(executor, config));
