// import { NodeHttpClient, NodeServices } from "@effect/platform-node";
// import { NodeSdk } from "@effect/opentelemetry";
// import type * as _Core from "@open-insight/core";
// import { Cause, Effect, Exit, Fiber, Option, Queue, Scope, Stream } from "effect";
// import * as Bench from "#/bench/index.ts";
// import * as Harness from "#/harness/index.ts";
// import type * as Metric from "#/metric/index.ts";
// import { type Executor } from "./build.ts";
// import { type Config } from "./config.ts";
// import { Error } from "./error.ts";
// import { type Event, EventTransportService } from "./event/index.ts";
// import type { Result } from "./result.ts";
// import { run as runSchedule } from "./schedule.ts";

// const annotateCombinationError =
//   (benchmark: Bench.Metadata, harness: Harness.Metadata) =>
//   (error: Error): Error =>
//     new Error({
//       reason: error.reason,
//       benchmark,
//       harness,
//     });

// const runEvaluation = (
//   { benchmark, harness, trailCount, metrics }: Executor,
//   config: Config,
//   eventQueue: Queue.Enqueue<Event>,
// ) => {
//   const benchmarkMetadata = Bench.metadata(benchmark);
//   const harnessMetadata = Harness.metadata(harness);

//   return runSchedule(
//     {
//       trailCount,
//       metrics,
//       bench: benchmark,
//       harness: harnessMetadata,
//       eventQueue,
//     },
//     config,
//   ).pipe(
//     Effect.provide(harness.layer),
//     Effect.mapError(Error.init),
//     Effect.mapError(annotateCombinationError(benchmarkMetadata, harnessMetadata)),
//   );
// };

// const withEventTransport = Effect.fn("eval/withEventTransport")(function* <A, R>(
//   evaluate: (eventQueue: Queue.Enqueue<Event>) => Effect.Effect<A, Error, R>,
// ): Effect.fn.Return<A, Error, R | Scope.Scope> {
//   const eventQueue = yield* Queue.bounded<Event, Cause.Done>(128);
//   const transport = yield* Effect.serviceOption(EventTransportService);
//   const stream = Stream.fromQueue(eventQueue);

//   const transportFiber = yield* Option.match(transport, {
//     onSome: (transport) => transport.send({ stream }),
//     onNone: () => stream.pipe(Stream.runDrain),
//   }).pipe(Effect.forkChild);

//   const evaluationExit = yield* evaluate(eventQueue).pipe(
//     Effect.raceFirst(Fiber.join(transportFiber).pipe(Effect.andThen(Effect.never))),
//     Effect.exit,
//   );

//   yield* Queue.end(eventQueue);

//   if (Exit.isFailure(evaluationExit)) {
//     yield* Fiber.await(transportFiber);
//     return yield* Effect.failCause(evaluationExit.cause);
//   }

//   yield* Fiber.join(transportFiber);
//   return evaluationExit.value;
// });

// const findDuplicateId = <A>(
//   values: ReadonlyArray<A>,
//   getId: (value: A) => string,
// ): string | undefined => {
//   const ids = new Set<string>();

//   for (const value of values) {
//     const id = getId(value);
//     if (ids.has(id)) {
//       return id;
//     }
//     ids.add(id);
//   }
// };

// export const run = Effect.fn(function* (
//   executor: Executor,
//   config: Config = {},
// ): Effect.fn.Return<Result, Error> {
//   let pipeline = withEventTransport((eventQueue) => runEvaluation(executor, config, eventQueue));

//   const otelConfig = config.otel;
//   if (otelConfig) {
//     pipeline = pipeline.pipe(Effect.provide(NodeSdk.layer(() => otelConfig)));
//   }

//   return yield* pipeline.pipe(Effect.scoped, Effect.provide(NodeServices.layer));
// });

// export const runMatrix = Effect.fn(function* (
//   {
//     benchmarks,
//     harnesses,
//   }: Readonly<{
//     benchmarks: ReadonlyArray<
//       Readonly<{
//         benchmark: Bench.Bench;
//         metrics?: Metric.Metrics;
//         trailCount?: number;
//       }>
//     >;
//     harnesses: ReadonlyArray<Harness.Harness>;
//   }>,
//   {
//     concurrency = 1,
//     eval: evalConfig = {},
//   }: Readonly<{
//     concurrency?: number;
//     eval?: Config;
//   }> = {},
// ): Effect.fn.Return<ReadonlyArray<ReadonlyArray<Result>>, Error> {
//   const duplicateBenchmark = findDuplicateId(benchmarks, ({ benchmark }) => benchmark.metadata.id);
//   if (duplicateBenchmark !== undefined) {
//     return yield* Effect.fail(
//       Error.init(new globalThis.Error(`Benchmark ids must be unique: "${duplicateBenchmark}"`)),
//     );
//   }

//   const duplicateHarness = findDuplicateId(harnesses, ({ metadata }) => metadata.id);
//   if (duplicateHarness !== undefined) {
//     return yield* Effect.fail(
//       Error.init(new globalThis.Error(`Harness ids must be unique: "${duplicateHarness}"`)),
//     );
//   }

//   if (benchmarks.length === 0) {
//     return [];
//   }
//   if (harnesses.length === 0) {
//     return benchmarks.map(() => []);
//   }

//   let pipeline = withEventTransport((eventQueue) => {
//     const evaluations = benchmarks.flatMap(({ benchmark, metrics, trailCount = 1 }) =>
//       harnesses.map((harness) =>
//         runEvaluation(
//           {
//             benchmark,
//             harness,
//             trailCount,
//             metrics: Option.fromNullishOr(metrics),
//           },
//           evalConfig,
//           eventQueue,
//         ),
//       ),
//     );

//     return Effect.all(evaluations, { concurrency });
//   });

//   const otelConfig = evalConfig.otel;
//   if (otelConfig) {
//     pipeline = pipeline.pipe(Effect.provide(NodeSdk.layer(() => otelConfig)));
//   }

//   const results = yield* pipeline.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

//   return benchmarks.map((_, benchIndex) => {
//     const start = benchIndex * harnesses.length;
//     return results.slice(start, start + harnesses.length);
//   });
// });

// export const runPromise = async <A, E>(
//   main: Effect.Effect<A, E, NodeServices.NodeServices>,
// ): Promise<A> =>
//   Effect.runPromise(
//     main.pipe(Effect.provide(NodeServices.layer), Effect.provide(NodeHttpClient.layerUndici)),
//   );
