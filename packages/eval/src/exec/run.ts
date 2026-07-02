import { Effect, Scope } from "effect";
import { NodeSdk } from "@effect/opentelemetry";
import { type Executor } from "./build.ts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { ExecError } from "./error.ts";
import { type Config } from "./config.ts";
import type * as _Core from "@open-insight/core";
import { run as runSchedule } from "./schedule.ts";
import type { ExecResult } from "./result.ts";

export const run = Effect.fn(function* <E, R>(
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

  let pipeline = runSchedule({ trailCount, tasks, metrics, metadata }, config).pipe(
    Effect.provide([agent, sandbox]),
    Effect.mapError(ExecError.init),
  );

  if (transport) {
    pipeline = pipeline.pipe(Effect.provide(transport));
  }

  const otelConfig = config?.otelConfig;
  if (otelConfig) {
    pipeline = pipeline.pipe(Effect.provide(NodeSdk.layer(() => otelConfig)));
  }

  return yield* pipeline.pipe(
    Effect.provide(NodeServices.layer),
    Effect.provide(NodeHttpClient.layerUndici),
  );
});

export const runPromise = async <E>(
  executor: Effect.Effect<Executor, E, Scope.Scope>,
  config?: Config,
) => Effect.runPromise(run(executor, config).pipe(Effect.scoped));
