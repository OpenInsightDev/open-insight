import { Prompt, Response, Sandbox } from "@open-insight/core/internal";
import { Data, Effect, Schema, Stream } from "effect";
import { MetricError } from "../error.ts";
import { Metadata, type MetadataEncoded } from "../schema.ts";
import { Toolkit } from "effect/unstable/ai";

export type SessionStream = Stream.Stream<Prompt.Prompt | Response.PartView<any>, MetricError>;

export class Metric<ID extends string, S extends Schema.Constraint> extends Data.Class<{
  id: ID;
  schema: S;
  metadata: Metadata;

  transform: (
    stream: Stream.Stream<Prompt.Prompt | Response.PartView<any>, MetricError>,
  ) => Stream.Stream<S["Type"], MetricError, Sandbox.Current>;
}> {}
export type Any = Metric<any, any>;

type Options = MetadataEncoded & Readonly<{}>;

export const make = <Toolkits extends ReadonlyArray<Toolkit.Any>>(...toolkits: Toolkits) =>
  Effect.fn(function* <ID extends string, S extends Schema.Constraint>(
    id: ID,
    schema: S,
    transformOption: (
      stream: Stream.Stream<
        Prompt.Prompt | Response.PartView<Toolkit.MergedTools<Toolkits>>,
        MetricError
      >,
    ) => Stream.Stream<S["Type"], unknown, Sandbox.Current>,
    options: Options = {},
  ) {
    const metadata = Schema.decodeSync(Metadata)(options);

    const merged = Toolkit.merge(...toolkits);

    const encode = Schema.encodeSync(Response.PartView(Toolkit.empty));
    const partView = Response.PartView(merged);
    const decode = Schema.decodeEffect(partView);
    const decodingServices = yield* Effect.context<typeof partView.DecodingServices>();

    const toolNames = new Set<string>(Object.keys(merged.tools));

    const transform = ((stream) => {
      const decoded = stream.pipe(
        Stream.mapEffect(
          Effect.fn(function* (value) {
            if (Prompt.isPrompt(value)) {
              return value;
            }
            if (value.type !== "tool-call" && value.type !== "tool-result") {
              return value;
            }
            if (!toolNames.has(value.name)) {
              return value;
            }

            const encoded = encode(value);
            return yield* decode(encoded).pipe(
              Effect.mapError(MetricError.toolMismatch(value.name, encoded)),
            );
          }),
        ),
      );

      // TODO
      return decoded.pipe(
        Stream.provideContext(decodingServices),
        transformOption,
        Stream.mapError(MetricError.transform),
      );
    }) satisfies Metric<ID, S>["transform"];

    return new Metric({
      id,
      schema,
      metadata,
      transform,
    });
  });
