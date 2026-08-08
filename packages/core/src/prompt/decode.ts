import { Option, Schema, Stream } from "effect";
import { Response, Tool, Toolkit } from "effect/unstable/ai";

/**
 * The `Response.StreamPart` tool-call/tool-result branches are keyed by the
 * specific tool name. Because the toolkit is not known before a part is observed
 * on the wire, build a permissive toolkit from the tool name carried by the
 * encoded part so that arbitrarily named tool calls/results decode without a
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
const StreamPartHead = Schema.Struct({
  type: Schema.Union([Schema.Literal("tool-call"), Schema.Literal("tool-result")]),
  name: Schema.String,
});

/**
 * Builds the toolkit needed to validate an encoded part, deriving the permissive
 * toolkit from the tool name carried by `tool-call`/`tool-result` parts and
 * falling back to the empty toolkit otherwise.
 */
const partToolkit = (encoded: Response.StreamPartEncoded): Toolkit.Any => {
  const head = Option.getOrNull(Schema.decodeUnknownOption(StreamPartHead)(encoded));
  return head?.name ? toolkitFor(head.name) : emptyToolkit;
};

const partSchema = (encoded: Response.StreamPartEncoded) =>
  Response.StreamPart(partToolkit(encoded));

/**
 * Decodes a stream of encoded response parts into typed `Response.AnyPart`s,
 * building a permissive toolkit from the tool name observed on each
 * `tool-call`/`tool-result` part so arbitrarily named tool calls/results decode
 * without a pre-declared toolkit.
 */
export const decodeResponsePartEncodedStream = <E, R>(
  stream: Stream.Stream<Response.StreamPartEncoded, E, R>,
): Stream.Stream<Response.StreamPart<never>, E | Schema.SchemaError, R> =>
  stream.pipe(
    Stream.mapEffect((encoded) => Schema.decodeUnknownEffect(partSchema(encoded))(encoded)),
  );
