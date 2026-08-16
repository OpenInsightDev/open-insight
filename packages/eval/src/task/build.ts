import { Effect, Schema } from "effect";
import * as Metric from "#/metric/index.ts";
import * as Grade from "#/grade/index.ts";
import { Harness, Sandbox, type Snapshot, Prompt } from "@open-insight/core/internal";
import type { BivariantFn } from "#/utils/variant.ts";
import { TaskError } from "./error.ts";

export type TypeId = "~open-insight/eval/task";
export const TypeId: TypeId = "~open-insight/eval/task";

export const ID = Schema.String;
export type ID = Schema.Schema.Type<typeof ID>;

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  id: Schema.String,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
  keywords: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
  authors: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export type Task<G extends Grade.AnyResult = never> = Readonly<{
  metadata: Metadata;
  snapshot: Snapshot.Template;

  metrics: ReadonlyArray<Metric.Task.Metric>;
  trajMetrics: ReadonlyArray<Metric.Traj.Metric>;
  schedMetrics: ReadonlyArray<Metric.Sched.Metric>;

  prompt: Prompt.Options;
  grader: Grade.Grader<G>;

  sandboxConfig: Harness.SandboxSessionConfig;

  [TypeId]: TypeId;
}> & { _G?: G };

export type AnyTask = Task<any>;
export type GradeOf<T> = T extends Task<infer G> ? G : never;

type Options<G extends Grade.AnyResult> = MetadataEncoded &
  Partial<Harness.SandboxSessionConfig> &
  Readonly<{
    snapshot: Snapshot.Template;
    prompt: Prompt.Options;
    grader: Grade.Grader<G>;
    trajMetrics?: ReadonlyArray<Metric.Traj.Metric>;
    schedMetrics?: ReadonlyArray<Metric.Sched.Metric>;
  }>;

export const make = Effect.fn(function* <G extends Grade.AnyResult>(
  options: Options<G>,
): Effect.fn.Return<Task<G>, TaskError> {
  const { snapshot, prompt, grader, trajMetrics = [], schedMetrics = [] } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(TaskError.metadata),
  );

  return {
    metadata,
    snapshot,
    trajMetrics,
    schedMetrics,
    metrics: [],
    prompt,
    grader,
    sandboxConfig: {
      ...Harness.DefaultSandboxSessionConfig,
      ...options,
    },
    [TypeId]: TypeId,
  } satisfies Task<G>;
});

export type Init = BivariantFn<(sandbox: Sandbox.SandboxPromise) => PromiseLike<void>>;
