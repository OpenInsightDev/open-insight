import { Effect, Stream } from "effect";
import * as Event from "#/event/index.ts";
import * as Bench from "#/bench/index.ts";
import * as Task from "#/task/index.ts";
import * as Config from "./config.ts";
import { make as makeStream } from "./stream.ts";
import { makeResultSink } from "./result.ts";

type EventStream<R = never> = Stream.Stream<Event.EvalSuccessEvent, Event.EvalErrorEvent, R>;

export const make =
  <T extends Task.AnyTask>(configOptions: Partial<Config.Config> = {}) =>
  (bench: Bench.Bench<T>) =>
    makeStream<T>(bench, Config.make(configOptions)).pipe();

export const run = <T extends Task.AnyTask>(
  bench: Bench.Bench<T>,
  configOptions: Partial<Config.Config> = {},
) => make<T>(configOptions)(bench);

export const stream = <R>(stream: EventStream<R>): Stream.Stream<Event.EvalEvent, never, R> =>
  stream.pipe(Stream.catch((event) => Stream.succeed(event)));

export const result = <T extends Task.AnyTask, R>(stream: EventStream<R>) => {
  const sink = makeResultSink<T>();
  throw new Error("Not implemented");
};

export * from "./error.ts";
