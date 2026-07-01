import { Effect, Layer, Scope } from "effect";
import { type Executor } from "./build.ts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { ExecError } from "./error.ts";
import { type Config } from "./config.ts";
import type * as _Core from "@open-insight/core";
import { run as runSchedule } from "./schedule.ts";
import type { ExecResult } from "./result/index.ts";
import { Agent, Sandbox } from "@open-insight/core/internal";

export const run = Effect.fn(
  function* <E, R>(
    executor: Effect.Effect<Executor, E, R>,
    config: Config = {},
  ): Effect.fn.Return<ExecResult, E | ExecError, R> {
    const {
      benchmark: { metadata, tasks },
      harness: { agent, sandbox },
      trailCount,
      metrics,
      transport,
    } = yield* executor;

    let eff = runSchedule({ trailCount, tasks, metrics, metadata }, config).pipe(
      Effect.provide([agent, sandbox]),
      Effect.mapError(ExecError.init),
    );

    // TODO how to provide optional layer
    if (transport) {
      eff = eff.pipe(Effect.provide(transport));
    }

    return yield* eff;
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
