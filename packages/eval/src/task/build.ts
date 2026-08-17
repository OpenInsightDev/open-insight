import { Effect, Schema } from "effect";
import * as Metric from "#/metric/index.ts";
import * as Grade from "#/grade/index.ts";
import { Harness, Sandbox, type Snapshot, Prompt } from "@open-insight/core/internal";
import type { BivariantFn } from "#/utils/variant.ts";
import * as Template from "./template.ts";
import { TaskError } from "./error.ts";
import { Metadata, type MetadataEncoded } from "./metadata.ts";

export type TypeId = "~open-insight/eval/task";
export const TypeId: TypeId = "~open-insight/eval/task";

export const ID = Schema.String;
export type ID = Schema.Schema.Type<typeof ID>;

export type Init = BivariantFn<(sandbox: Sandbox.SandboxPromise) => PromiseLike<void>>;

export type Task<T extends Template.Template> = Readonly<{
  metadata: Metadata;
  extra: Template.ExtraOf<T>["Type"];

  snapshot: Snapshot.Template;

  metrics: ReadonlyArray<Metric.Task.Metric>;
  trajMetrics: ReadonlyArray<Metric.Traj.Metric>;
  schedMetrics: ReadonlyArray<Metric.Sched.Metric>;

  prompt: Prompt.Options;
  grader: Grade.Grader<Template.GradeOf<T>>;

  sandboxConfig: Harness.SandboxSessionConfig;

  [TypeId]: TypeId;
}>;

export type AnyTask = Task<any>;
export type GradeOf<T> = T extends Task<infer U> ? Template.GradeOf<U> : never;

type Options<T extends Template.Template> = MetadataEncoded &
  Partial<Harness.SandboxSessionConfig> &
  Template.ExtraOf<T>["Type"] &
  Readonly<{
    snapshot: Snapshot.Template;
    prompt: Prompt.Options;
    grader: Grade.Variant<Template.GradeOf<T>>;

    metrics?: ReadonlyArray<Metric.Task.Metric<Template.GradeOf<T>>>;
    trajMetrics?: ReadonlyArray<Metric.Traj.Metric>;
    schedMetrics?: ReadonlyArray<Metric.Sched.Metric>;
  }>;

export const make = <T extends Template.Template>(template: T) =>
  Effect.fn(function* (options: Options<T>) {
    const {
      snapshot,
      prompt,
      grader: variant,
      metrics = [],
      trajMetrics = [],
      schedMetrics = [],
    } = options;
    const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
      Effect.mapError(TaskError.metadata),
    );

    return {
      metadata,
      extra: options,
      snapshot,
      metrics,
      trajMetrics,
      schedMetrics,
      prompt,
      grader: {
        schema: template.Grade,
        variant,
      },
      sandboxConfig: {
        ...Harness.DefaultSandboxSessionConfig,
        ...options,
      },
      [TypeId]: TypeId,
    } satisfies Task<T>;
  });
