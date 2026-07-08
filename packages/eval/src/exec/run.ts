import { Effect, Option } from "effect";
import { NodeSdk } from "@effect/opentelemetry";
import { type Executor } from "./build.ts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { Error } from "./error.ts";
import { type Config } from "./config.ts";
import type * as _Core from "@open-insight/core";
import { run as runSchedule } from "./schedule.ts";
import type { Result } from "./result.ts";

export const run = Effect.fn(function* (
  { transport, benchmark, harness, trailCount, metrics }: Executor,
  config: Config = {},
): Effect.fn.Return<Result, Error> {
  let pipeline = runSchedule({ trailCount, metrics, benchmark }, config).pipe(
    Effect.provide(harness.layer),
    Effect.mapError(Error.init),
  );

  if (Option.isSome(transport)) {
    pipeline = pipeline.pipe(Effect.provide(transport.value));
  }

  const otelConfig = config?.otel;
  if (otelConfig) {
    pipeline = pipeline.pipe(Effect.provide(NodeSdk.layer(() => otelConfig)));
  }

  return yield* pipeline.pipe(Effect.scoped).pipe(Effect.provide(NodeServices.layer));
});

export const runPromise = async <E>(main: Effect.Effect<Result, E, NodeServices.NodeServices>) =>
  Effect.runPromise(
    main.pipe(Effect.provide(NodeServices.layer), Effect.provide(NodeHttpClient.layerUndici)),
  );
