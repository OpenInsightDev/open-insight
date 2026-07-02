import { Effect, FileSystem, Option, Path, Scope } from "effect";
import { NodeSdk } from "@effect/opentelemetry";
import { type Executor } from "./build.ts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { ExecError } from "./error.ts";
import { type Config } from "./config.ts";
import type * as _Core from "@open-insight/core";
import { run as runSchedule } from "./schedule.ts";
import type { ExecResult } from "./result.ts";
import type { ChildProcessSpawner } from "effect/unstable/process";

export const run = Effect.fn(
  function* <E, R>(
    executor: Effect.Effect<Executor, E, R>,
    config: Config = {},
  ): Effect.fn.Return<
    ExecResult,
    E | ExecError,
    R | FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
  > {
    const {
      benchmark,
      harness: { layer },
      trailCount,
      metrics,
      transport,
    } = yield* executor;

    let pipeline = runSchedule({ trailCount, metrics, benchmark }, config).pipe(
      Effect.provide(layer),
      Effect.mapError(ExecError.init),
    );

    if (Option.isSome(transport)) {
      pipeline = pipeline.pipe(Effect.provide(transport.value));
    }

    const otelConfig = config?.otel;
    if (otelConfig) {
      pipeline = pipeline.pipe(Effect.provide(NodeSdk.layer(() => otelConfig)));
    }

    return yield* pipeline;
  },
  (effect) =>
    effect
      .pipe(Effect.provide(NodeServices.layer), Effect.provide(NodeHttpClient.layerUndici))
      .pipe(Effect.scoped),
);

export const runPromise = async <E>(
  executor: Effect.Effect<Executor, E, Scope.Scope>,
  config?: Config,
) => Effect.runPromise(run(executor, config));
