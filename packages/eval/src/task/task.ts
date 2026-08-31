import { Prompt, Resource, Snapshot } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import { Data, Effect, Match, Schema } from "effect";

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export class Task<ID extends string, G extends Schema.Constraint> extends Data.TaggedClass("Task")<{
  id: ID;
  metadata: Metadata;

  prompt: Prompt.Turns;
  snapshot: Snapshot.Template;
  resources: Resource.Resources;
  grader: Grade.Grader<G>;
}> {}

export type Any = Task<any, any>;

export type GradeOf<T> = T extends Task<infer _, infer G> ? G : never;
export type IdOf<T> = T extends Task<infer ID, infer _> ? ID : never;

type Options<G extends Schema.Constraint> = MetadataEncoded &
  Readonly<{
    prompt: Prompt.RawInput | Prompt.Turns;
    grader: Grade.Grader<G>;

    description?: string | null;
    snapshot?: Snapshot.Template;
    resources?: Resource.Resources;
  }>;

export const make = Effect.fn(function* <ID extends string, G extends Schema.Constraint>(
  id: ID,
  options: Options<G>,
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
