import { Effect, Schema, Stream } from "effect";
import { Response, type Tool, Toolkit } from "effect/unstable/ai";

type ToolPart = Response.AnyToolCallPart | Response.AnyToolResultPart;
type ToolPartName = ToolPart["name"];

const isToolPart = (part: Response.AnyPart): part is ToolPart =>
  part.type === "tool-call" || part.type === "tool-result";

/**
 * Decodes a response stream with an additional toolkit.
 *
 * Tool parts are first encoded with the empty toolkit so that both toolkit
 * specific and unknown tool parts can cross the schema boundary. Parts whose
 * names are not in the new toolkit retain their existing decoded value; this
 * keeps the original toolkit's types while allowing the new toolkit to decode
 * its own tools.
 */
export const decodeStreamWithToolkit = <
  Tools extends Record<string, Tool.Any>,
  NewTools extends Record<string, Tool.Any>,
  E,
  R,
>(
  stream: Stream.Stream<Response.StreamPart<Tools>, E, R>,
  toolkit: Toolkit.Toolkit<NewTools>,
): Stream.Stream<
  Response.StreamPart<Tools> | Response.StreamPart<NewTools>,
  E | Schema.SchemaError,
  R | Tool.ResultDecodingServicesFor<NewTools>
> => {
  const decode = Schema.decodeUnknownEffect(Response.StreamPart(toolkit));
  const encode = Schema.encodeUnknownEffect(Response.StreamPart(Toolkit.empty));
  const toolNames = new Set<ToolPartName>(Object.values(toolkit.tools).map((tool) => tool.name));

  return stream.pipe(
    Stream.mapEffect((part) => {
      if (!isToolPart(part)) return Effect.succeed(part);

      return encode(part).pipe(
        Effect.flatMap(decode),
        Effect.map((decoded) => (toolNames.has(part.name) ? decoded : part)),
      );
    }),
  ) as Stream.Stream<
    Response.StreamPart<Tools> | Response.StreamPart<NewTools>,
    E | Schema.SchemaError,
    R | Tool.ResultDecodingServicesFor<NewTools>
  >;
};
