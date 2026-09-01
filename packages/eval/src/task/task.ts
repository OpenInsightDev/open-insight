import { Prompt, Resource, Snapshot } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import { Data, Layer, Match, Schema } from "effect";

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export class Task<ID extends string, G extends Schema.Constraint> extends Data.TaggedClass("Task")<{
  id: ID;
  metadata: Metadata;

  prompt: Layer.Layer<Prompt.Session.Service>;
  snapshot: Snapshot.Template;
  resources: Resource.Resources;
  grader: Grade.Grader<G>;
}> {}

export type Any = Task<any, any>;

export type GradeOf<T> = T extends Task<infer _, infer G> ? G : never;
export type IdOf<T> = T extends Task<infer ID, infer _> ? ID : never;

type Options<G extends Schema.Constraint> = MetadataEncoded &
  Readonly<{
    prompt: Prompt.RawInput | Prompt.Session.Provider;
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
    resources = Resource.providerDefault,
    ...encoded
  } = options;

  const metadata = Schema.decodeSync(Metadata)(encoded);

  const sessionLayer = Match.value(prompt).pipe(
    Match.tag("Provider", (provider) => Layer.succeed(Prompt.Session.Service, provider)),
    Match.orElse((rawInput) => Prompt.Session.layerFromPrompt(rawInput)),
  );

  return new Task({
    id,
    metadata,
    snapshot,
    resources,
    prompt: sessionLayer,
    grader,
  });
};
