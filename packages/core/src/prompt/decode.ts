import { Effect, Option, Schema, Stream } from "effect";
import { Response, Tool, Toolkit } from "effect/unstable/ai";

/**
 * The `Response.Part` tool-call/tool-result branches are keyed by the specific
 * tool name. Because the toolkit is not known before a part is observed on the
 * wire, build a permissive toolkit from the tool name carried by the encoded
 * part so that arbitrarily named tool calls/results decode without a
 * pre-declared toolkit.
 */
const toolkitFor = (name: string): Toolkit.Any =>
  Toolkit.make(
    Tool.make(name, {
      parameters: Schema.Unknown,
      success: Schema.Unknown,
      failure: Schema.Unknown,
    }),
  );

/** An empty toolkit: sufficient to decode parts that are not tool-bound. */
export const emptyToolkit: Toolkit.Any = Toolkit.make();

/** Lightweight head schema used to peek the tool name off an encoded part. */
const PartHead = Schema.Struct({
  type: Schema.Union([Schema.Literal("tool-call"), Schema.Literal("tool-result")]),
  name: Schema.String,
});

/**
 * Builds the toolkit needed to validate an encoded part, deriving the permissive
 * toolkit from the tool name carried by `tool-call`/`tool-result` parts and
 * falling back to the empty toolkit otherwise.
 */
const toolkitForPart = (encoded: Response.StreamPartEncoded): Toolkit.Any => {
  const head = Option.getOrNull(Schema.decodeUnknownOption(PartHead)(encoded));
  return head?.name ? toolkitFor(head.name) : emptyToolkit;
};

const streamPartSchema = (encoded: Response.StreamPartEncoded) =>
  Response.StreamPart(toolkitForPart(encoded));

export type AnyStreamPart = Response.StreamPart<Record<string, Tool.Any>>;

/**
 * Decodes a single encoded stream part (`Response.StreamPartEncoded`) into its
 * typed form, building a permissive toolkit from the tool name observed on each
 * `tool-call`/`tool-result` part.
 */
export const decodeResponseStreamPartEncoded = (
  encoded: Response.StreamPartEncoded,
): Effect.Effect<AnyStreamPart, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(streamPartSchema(encoded))(encoded);

/**
 * Decodes a stream of encoded response stream parts
 * (`Response.StreamPartEncoded`) into typed stream parts, one per event.
 */
export const decodeResponseStream = <E, R>(
  stream: Stream.Stream<Response.StreamPartEncoded, E, R>,
): Stream.Stream<AnyStreamPart, E | Schema.SchemaError, R> =>
  stream.pipe(Stream.mapEffect(decodeResponseStreamPartEncoded));
