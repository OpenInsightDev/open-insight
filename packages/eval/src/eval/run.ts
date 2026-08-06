import { Effect, Option, Queue, Scope, Stream } from "effect";
import * as Event from "#/event/index.ts";
import { type Config, make as makeConfig } from "./config.ts";
import * as Bench from "#/bench/index.ts";
import { run as runSchedule } from "./schedule.ts";
import type { BenchResult } from "./result.ts";
import { NodeServices } from "@effect/platform-node";
import { EvalError } from "./error.ts";
import { Harness } from "@open-insight/core/internal";
import * as Task from "#/task/index.ts";

export const run = (configOptions: Partial<Config> = {}) =>
  Effect.fn(function* <T extends Task.AnyTask, E, R>(
    bench: Effect.Effect<Bench.Bench<T>, E, R>,
  ): Effect.fn.Return<BenchResult<Task.GradeOf<T>>, EvalError | E, Harness.Service | R> {
    const config = makeConfig(configOptions);
    const transport = yield* Effect.serviceOption(Event.Transport.Service);
    const eventQueue = yield* Event.makeQueue();
    const harness = yield* Harness.Service;

    const eventStream = Stream.fromQueue(eventQueue);

    const consume = transport.pipe(
      Option.match({
        onNone: () => Stream.runDrain(eventStream).pipe(Effect.mapError(EvalError.event)),
        onSome: (transport) =>
          transport.send(eventStream).pipe(Effect.mapError(EvalError.event), Effect.scoped),
      }),
    );

    const result = yield* bench
      .pipe(
        Effect.flatMap((bench) =>
          Effect.zipWith(
            runSchedule({ bench, eventQueue }, config).pipe(Effect.ensuring(Queue.end(eventQueue))),
            consume,
            (result) => result,
            { concurrent: true },
          ),
        ),
      )
      .pipe(Effect.provide(NodeServices.layer))
      .pipe(Effect.provideService(Harness.Service, harness));

    return result as BenchResult<Task.GradeOf<T>>;
  });

export const toPromise = <T, E>(
  effect: Effect.Effect<T, E, NodeServices.NodeServices | Scope.Scope>,
) => Effect.runPromise(effect.pipe(Effect.scoped).pipe(Effect.provide(NodeServices.layer)));
