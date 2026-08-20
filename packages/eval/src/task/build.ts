import { Effect, Schema } from "effect";
import * as Metric from "#/metric/index.ts";
import * as Grade from "#/grade/index.ts";
import { Harness, Sandbox, type Snapshot, Prompt } from "@open-insight/core/internal";
import type { BivariantFn } from "#/utils/variant.ts";
import { TaskError } from "./error.ts";
import { Metadata, type MetadataEncoded } from "./metadata.ts";

const Empty = Schema.Struct({});

export type TypeId = "~open-insight/eval/task";
export const TypeId: TypeId = "~open-insight/eval/task";

export const ID = Schema.String;
export type ID = Schema.Schema.Type<typeof ID>;

export type Init = BivariantFn<(sandbox: Sandbox.SandboxPromise) => PromiseLike<void>>;

export type Task<G extends Grade.AnyResult = any, E extends Schema.Constraint = any> = Readonly<{
  gradeSchema: G;
  extraSchema: E;

  metadata: Metadata;
  extra: E["Type"];

  snapshot: Snapshot.Template;

  metrics: ReadonlyArray<Metric.Task.Metric<G>>;
  trajMetrics: ReadonlyArray<Metric.Traj.Metric>;
  schedMetrics: ReadonlyArray<Metric.Sched.Metric>;

  prompt: Prompt.Gen.Options;
  grader: Grade.Grader<G>;

  sandboxConfig: Harness.SandboxSessionConfig;

  [TypeId]: TypeId;
}>;

export type AnyTask = Task<any, any>;

export type GradeOf<T> = T extends Task<infer G, infer _> ? G : never;
export type GradeTypeOf<T> = GradeOf<T>["Type"];
export type GradeEncodedOf<T> = GradeOf<T>["Encoded"];

export type ExtraOf<T> = T extends Task<infer _, infer E> ? E : never;

type Options<G extends Grade.AnyResult, E extends Schema.Constraint> = MetadataEncoded &
  Partial<Harness.SandboxSessionConfig> &
  E["Type"] &
  Readonly<{
    snapshot: Snapshot.Template;
    prompt: Prompt.Gen.Options;
    grader: Grade.Variant<G>;

    metrics?: ReadonlyArray<Metric.Task.Metric<G>>;
    trajMetrics?: ReadonlyArray<Metric.Traj.Metric>;
    schedMetrics?: ReadonlyArray<Metric.Sched.Metric>;
  }>;

const makeTask = <G extends Grade.AnyResult, E extends Schema.Constraint>(schemas: {
  gradeSchema: G;
  extraSchema: E;
}) =>
  Effect.fn(function* (options: Options<G, E>) {
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
      ...schemas,
      metadata,
      extra: options,
      snapshot,
      metrics,
      trajMetrics,
      schedMetrics,
      prompt,
      grader: { schema: schemas.gradeSchema, variant },
      sandboxConfig: {
        ...Harness.DefaultSandboxSessionConfig,
        ...options,
      },
      [TypeId]: TypeId,
    } satisfies Task<G, E>;
  });

export function make<G extends Grade.AnyResult>(
  gradeSchema: G,
): ReturnType<typeof makeTask<G, typeof Empty>>;
export function make<G extends Grade.AnyResult, E extends Schema.Constraint>(
  gradeSchema: G,
  extraSchema: E,
): ReturnType<typeof makeTask<G, E>>;
export function make<G extends Grade.AnyResult, E extends Schema.Constraint>(
  gradeSchema: G,
  extraSchema?: E,
) {
  if (extraSchema === undefined) {
    return makeTask<G, typeof Empty>({ gradeSchema, extraSchema: Empty });
  } else {
    return makeTask<G, E>({ gradeSchema, extraSchema });
  }
}
