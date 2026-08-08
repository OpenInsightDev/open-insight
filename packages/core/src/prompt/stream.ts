import { Match, Stream } from "effect";
import { Prompt, Response } from "effect/unstable/ai";

/**
 * Converts a single encoded response part (`Response.PartEncoded`) into the
 * corresponding prompt parts. Parts with no `Prompt.Part` analogue (sources,
 * response-metadata, finish, etc.) are dropped.
 */
const fromPart = (part: Response.PartEncoded): ReadonlyArray<Prompt.Part> =>
  Match.value(part).pipe(
    Match.withReturnType<ReadonlyArray<Prompt.Part>>(),
    Match.discriminator("type")("text", (part) => [Prompt.textPart({ text: part.text })]),
    Match.discriminator("type")("reasoning", (part) => [
      Prompt.reasoningPart({ text: part.text }),
    ]),
    Match.discriminator("type")("tool-call", (part) => [
      Prompt.toolCallPart({
        id: part.id,
        name: part.name,
        params: part.params,
        providerExecuted: part.providerExecuted ?? false,
      }),
    ]),
    Match.discriminator("type")("tool-result", (part) =>
      (part.preliminary ?? false)
        ? []
        : [
            Prompt.toolResultPart({
              id: part.id,
              name: part.name,
              isFailure: part.isFailure,
              result: part.result,
              providerExecuted: part.providerExecuted ?? false,
            }),
          ],
    ),
    Match.discriminator("type")("tool-approval-request", (part) => [
      Prompt.toolApprovalRequestPart({
        approvalId: part.approvalId,
        toolCallId: part.toolCallId,
      }),
    ]),
    Match.orElse(() => []),
  );

/**
 * Converts a stream of encoded response parts (`Response.PartEncoded`) into
 * prompt parts.
 */
export const fromResponsePartEncodedStream = <E, R>(
  stream: Stream.Stream<Response.PartEncoded, E, R>,
): Stream.Stream<Prompt.Part, E, R> => stream.pipe(Stream.map(fromPart), Stream.flattenIterable);
