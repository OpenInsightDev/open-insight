import { Prompt, Resource, Snapshot } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import { Data, Effect, Match, Schema } from "effect";

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export class Task<
  ID extends string = string,
  Grader extends Grade.Any = Grade.Any,
> extends Data.TaggedClass("Task")<{
  id: ID;
  metadata: Metadata;

  prompt: Prompt.Turns;
  snapshot: Snapshot.Template;
  resources: Resource.Resources;
  grader: Grader;
}> {}

export type Any = Task<any, any>;

export type GraderOf<T> = T extends Task<infer _, infer Grader> ? Grader : never;
export type IdOf<T> = T extends Task<infer ID, infer _> ? ID : never;

type Options<Grader extends Grade.Any = Grade.Any> = MetadataEncoded &
  Readonly<{
    prompt: Prompt.RawInput | Prompt.Turns;
    grader: Grader;

    description?: string | null;
    snapshot?: Snapshot.Template;
    resources?: Resource.Resources;
  }>;

export const make = Effect.fn(function* <ID extends string, Grader extends Grade.Any>(
  id: ID,
  options: Options<Grader>,
) {
  const {
    prompt,
    grader,
    snapshot = Snapshot.Alpine,
    resources = Resource.providerDefault,
    ...encoded
  } = options;

  const metadata = Schema.decodeSync(Metadata)(encoded);

  const turns = yield* Match.value(prompt).pipe(
    Match.tag("Turns", (turns) => Effect.succeed(turns)),
    Match.orElse((rawInput) => Prompt.makeTurns(Prompt.make(rawInput))),
  );

  return new Task({
    id,
    metadata,
    snapshot,
    resources,
    prompt: turns,
    grader,
  });
});
