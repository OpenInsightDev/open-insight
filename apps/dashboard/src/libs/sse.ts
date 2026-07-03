import { Exec, type Event as EvalEvent } from "@open-insight/eval";
import { Effect, Queue, Schema, Scope, Stream } from "effect";
import { Sse } from "effect/unstable/encoding";

interface RawSseMessage {
  readonly id: string | undefined;
  readonly event: string;
  readonly data: unknown;
}

export interface SseMessage<A> {
  readonly id: string | undefined;
  readonly event: string;
  readonly data: A;
}

export interface FromEventSourceOptions {
  readonly event?: string;
  readonly bufferSize?: number;
  readonly strategy?: "sliding" | "dropping" | "suspend";
}

const toMessageEvent = (event: Event): MessageEvent<unknown> | undefined =>
  event instanceof MessageEvent ? event : undefined;

const fromMessageEvent = (event: MessageEvent<unknown>) => ({
  id: event.lastEventId === "" ? undefined : event.lastEventId,
  event: event.type,
  data: event.data,
});

const messageSchema = <A, R>(data: Schema.ConstraintDecoder<A, R>) =>
  Schema.Struct({
    ...Sse.EventEncoded.fields,
    data: Schema.fromJsonString(data),
  });

const decodeMessage = <A, R>(data: Schema.ConstraintDecoder<A, R>) => {
  const decode = Schema.decodeUnknownEffect(messageSchema(data));

  return (message: RawSseMessage) =>
    decode(message).pipe(
      Effect.map((decoded) => ({
        id: decoded.id,
        event: decoded.event,
        data: decoded.data,
      })),
    );
};

const rawMessages = (
  source: EventSource,
  eventNames: ReadonlyArray<string>,
  options?: FromEventSourceOptions,
): Stream.Stream<RawSseMessage> =>
  Stream.callback<RawSseMessage>(
    (queue) =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;

        const onMessage = (event: Event) => {
          const message = toMessageEvent(event);

          if (message === undefined) {
            return;
          }

          Queue.offerUnsafe(queue, fromMessageEvent(message));
        };

        for (const eventName of eventNames) {
          source.addEventListener(eventName, onMessage);
        }

        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => {
            for (const eventName of eventNames) {
              source.removeEventListener(eventName, onMessage);
            }
          }),
        );
      }),
    {
      bufferSize: options?.bufferSize,
      strategy: options?.strategy,
    },
  );

const evalEventNames = [
  "InitEvent",
  "TaskScheduleEvent",
  "BenchScheduleEvent",
  "MetricsStreamEvent",
  "TaskStreamPartEvent",
] satisfies ReadonlyArray<EvalEvent["_tag"]>;

type EvalEventDecodingServices = Schema.Codec.DecodingServices<typeof Exec.EventSchema>;

export const fromEventSourceMessages = <A, R>(
  source: EventSource,
  data: Schema.ConstraintDecoder<A, R>,
  options?: FromEventSourceOptions,
): Stream.Stream<SseMessage<A>, Schema.SchemaError, R> =>
  rawMessages(source, [options?.event ?? "message"], options).pipe(
    Stream.mapEffect(decodeMessage(data)),
  );

export const fromEventSource = <A, R>(
  source: EventSource,
  data: Schema.ConstraintDecoder<A, R>,
  options?: FromEventSourceOptions,
): Stream.Stream<A, Schema.SchemaError, R> =>
  fromEventSourceMessages(source, data, options).pipe(Stream.map((message) => message.data));

export type FromEvalEventSourceOptions = Omit<FromEventSourceOptions, "event">;

export const fromEvalEventSourceMessages = (
  source: EventSource,
  options?: FromEvalEventSourceOptions,
): Stream.Stream<SseMessage<EvalEvent>, Schema.SchemaError, EvalEventDecodingServices> =>
  rawMessages(source, evalEventNames, options).pipe(
    Stream.mapEffect(decodeMessage(Exec.EventSchema)),
  );

export const fromEvalEventSource = (
  source: EventSource,
  options?: FromEvalEventSourceOptions,
): Stream.Stream<EvalEvent, Schema.SchemaError, EvalEventDecodingServices> =>
  fromEvalEventSourceMessages(source, options).pipe(Stream.map((message) => message.data));
