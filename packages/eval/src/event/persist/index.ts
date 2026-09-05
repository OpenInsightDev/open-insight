import { Context, Effect, FileSystem, Layer, Stream } from "effect";
import { Ndjson } from "effect/unstable/encoding";

import * as Event from "#/event/index.ts";
import { EventError } from "../error.ts";

export type PersistError = EventError;

export type Provider = Readonly<{
  readonly save: <E, R>(
    path: string,
    events: Stream.Stream<Event.Event, E, R>,
  ) => Effect.Effect<void, E | PersistError, R>;
  readonly load: (path: string) => Stream.Stream<Event.Event, PersistError>;
}>;

export class Service extends Context.Service<Service, Provider>()("eval/event/Persist") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const encoder = Ndjson.encodeSchema(Event.Event);
    const decoder = Ndjson.decodeSchema(Event.Event);

    const save: Provider["save"] = (path, events) =>
      events.pipe(
        Stream.pipeThroughChannel(encoder()),
        Stream.run(fs.sink(path)),
        Effect.mapError(EventError.persist),
      );

    const load: Provider["load"] = (path) =>
      fs
        .stream(path)
        .pipe(
          Stream.pipeThroughChannel(decoder({ ignoreEmptyLines: true })),
          Stream.mapError(EventError.persist),
        );

    return Service.of({ save, load });
  }),
);
