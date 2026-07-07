import { Effect, Option } from "effect";
import { NodeSdk } from "@effect/opentelemetry";
import { type Executor } from "./build.ts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { ExecError } from "./error.ts";
import { type Config } from "./config.ts";
import type * as _Core from "@open-insight/core";
import { run as runSchedule } from "./schedule.ts";
import type { Result } from "./result.ts";

export const run = Effect.fn(function* (
  { transport, benchmark, endpoint, harness, trailCount, metrics }: Executor,
  config: Config = {},
): Effect.fn.Return<Result, ExecError> {
  let pipeline = runSchedule({ trailCount, metrics, benchmark, endpoint }, config).pipe(
    Effect.provide(harness.layer),
    Effect.mapError(ExecError.init),
  );

  if (Option.isSome(transport)) {
    pipeline = pipeline.pipe(Effect.provide(transport.value));
  }

  const otelConfig = config?.otel;
  if (otelConfig) {
    pipeline = pipeline.pipe(Effect.provide(NodeSdk.layer(() => otelConfig)));
  }

  return yield* pipeline
    .pipe(Effect.provide(NodeServices.layer), Effect.provide(NodeHttpClient.layerUndici))
    .pipe(Effect.scoped);
});

export const runPromise = async <E>(executor: Effect.Effect<Executor, E>, config?: Config) =>
  Effect.runPromise(executor.pipe(Effect.flatMap((executor) => run(executor, config))));
