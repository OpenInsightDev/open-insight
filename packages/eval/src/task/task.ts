import { Prompt, Resource, Snapshot } from "@open-insight/core/internal";
import * as Metric from "#/metric/index.ts";
import * as Grade from "#/grade/index.ts";
import { Data, Layer, Schema } from "effect";

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export class Task<
  ID extends string = string,
  G extends Schema.Constraint = any,
> extends Data.Class<{
  id: ID;
  metadata: Metadata;

  prompt: Layer.Layer<Prompt.Fn.Service>;
  snapshot: Snapshot.Template;
  resources: Resource.Resources;
  grader: Grade.Grader<G>;

  schedMetrics: Metric.Sched.Metric[];
  trajMetrics: Metric.Traj.Metric[];
}> {}

export type GradeOf<T> = T extends Task<infer _, infer G> ? G : never;

export type Any = Task<any, any>;

type Options<G extends Schema.Constraint> = MetadataEncoded &
  Readonly<{
    prompt: Prompt.Fn.Options;
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
    prompt: promptOptions,
    grader,
    snapshot = Snapshot.Alpine,
    resources = Resource.empty,
    ...encoded
  } = options;
  const metadata = Schema.decodeSync(Metadata)(encoded);
  const prompt = Prompt.Fn.layerFrom(promptOptions);
  return new Task({ id, metadata, snapshot, resources, prompt, grader });
};
