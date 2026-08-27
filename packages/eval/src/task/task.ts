import { Prompt, Resource, Snapshot } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import { Data, Match, Schema } from "effect";

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export class Task<
  ID extends string = string,
  G extends Schema.Constraint = any,
> extends Data.TaggedClass("Task")<{
  id: ID;
  metadata: Metadata;

  prompt: Prompt.Turns;
  snapshot: Snapshot.Template;
  resources: Resource.Resources;
  grader: Grade.Grader<G>;
}> {}

export type GradeOf<T> = T extends Task<infer _, infer G> ? G : never;
export type IdOf<T> = T extends Task<infer ID, infer _> ? ID : never;

export type Any = Task<any, any>;

type Options<G extends Schema.Constraint> = MetadataEncoded &
  Readonly<{
    prompt: Prompt.RawInput | Prompt.Turns;
    grader: Grade.Grader<G>;

    description?: string | null;
    snapshot?: Snapshot.Template;
    resources?: Resource.Resources;
  }>;

export const make = <ID extends string, G extends Schema.Constraint>(
  id: ID,
  options: Options<G>,
) => {
  const {
    prompt,
    grader,
    snapshot = Snapshot.Alpine,
    resources = Resource.empty,
    ...encoded
  } = options;

  const metadata = Schema.decodeSync(Metadata)(encoded);

  const turns = Match.value(prompt).pipe(
    Match.tag("Turns", (turns) => turns),
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
};
