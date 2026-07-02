import type * as Grade from "./grade/index.ts";
import type { Contravariant } from "../utils/variant.ts";
import { Sandbox } from "@open-insight/core/internal";
import { type Brand, Effect, Schema, type Scope } from "effect";
import { Prompt } from "effect/unstable/ai";
import { TaskError } from "./error.ts";
import { assertNonNull } from "@/utils/type.ts";

export type ID = string;

export const MetadataSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  keywords: Schema.optional(Schema.Array(Schema.String)),
  authors: Schema.optional(Schema.Array(Schema.String)),
});
export type Metadata = Schema.Schema.Type<typeof MetadataSchema>;

export type Task<G extends Grade.Grader = Grade.Grader> = Readonly<{
  metadata: Metadata;

  graders: Grade.Map<G>;
  prompt: ReadonlyArray<Prompt.UserMessage>;

  context: Sandbox.Context.Context;
  gradeContext: Sandbox.Context.Context | null;

  snapshot: Sandbox.Snapshot.Snapshot;

  resources: Sandbox.ResourceLimits | null;
}> & { _G?: G };

export type BuiltTask<T extends Task = Task> = Effect.Effect<T, TaskError, Scope.Scope>;
export type Tasks<T extends Task = Task> = ReadonlyArray<BuiltTask<T>>;

export type GraderOf<T> = T extends Task<infer G> ? G : never;

type Builder<G extends Grade.Grader = Grade.Grader, H = never, R = never> = Effect.Effect<
  Partial<Task<G>>,
  TaskError,
  R
> & {
  _typestate?: Contravariant<H>;
};

export const init = <T extends Task>(metadata: Metadata): Builder<GraderOf<T>> =>
  Effect.succeed({ metadata } as Partial<Task<GraderOf<T>>>);

type HasPrompt = Brand.Brand<"prompt">;
export const withPrompt =
  (prompt: Readonly<[Prompt.UserMessage, ...Prompt.UserMessage[]]>) =>
  <G extends Grade.Grader, H, R>(build: Builder<G, H, R>): Builder<G, H | HasPrompt, R> =>
    Effect.map(build, (t) => ({ ...t, prompt }));

export const withTextPrompt =
  (text: string) =>
  <G extends Grade.Grader, H, R>(build: Builder<G, H, R>): Builder<G, H | HasPrompt, R> =>
    Effect.map(build, (t) => ({
      ...t,
      prompt: [
        ...(t.prompt ?? []),
        Prompt.userMessage({
          content: [Prompt.textPart({ text })],
        }),
      ],
    }));

type HasContext = Brand.Brand<"context">;
export const withContext =
  <CE, CR>(context: Effect.Effect<Sandbox.Context.Context, CE, CR>) =>
  <G extends Grade.Grader, H, R>(build: Builder<G, H, R>): Builder<G, H | HasContext, R | CR> =>
    Effect.fn("task/withContext")(function* () {
      const t = yield* build;
      const resolvedContext = yield* context.pipe(Effect.mapError(TaskError.load));
      return { ...t, context: resolvedContext };
    })();

export const withGradeContext =
  <CE, CR>(gradeContext: Effect.Effect<Sandbox.Context.Context, CE, CR>) =>
  <G extends Grade.Grader, H, R>(build: Builder<G, H, R>): Builder<G, H, R | CR> =>
    Effect.fn("task/withGradeContext")(function* () {
      const t = yield* build;
      const resolvedGradeContext = yield* gradeContext.pipe(Effect.mapError(TaskError.load));
      return { ...t, gradeContext: resolvedGradeContext };
    })();

export const withSnapshot =
  (snapshot: Sandbox.Snapshot.Snapshot) =>
  <G extends Grade.Grader, H, R>(build: Builder<G, H, R>): Builder<G, H, R> =>
    Effect.map(build, (t) => ({ ...t, snapshot }));

export const withGrader =
  <N extends string, T>(name: N, exec: Grade.Exec<T>) =>
  <G extends Grade.Grader, H, R>(build: Builder<G, H, R>): Builder<G, H | Grade.Grader<N, T>, R> =>
    Effect.map(build, (t) => ({
      ...t,
      graders: Object.assign({}, t.graders, { [name]: exec }),
    }));

export const withResources =
  (resources: Sandbox.ResourceLimits) =>
  <G extends Grade.Grader, H, R>(build: Builder<G, H, R>): Builder<G, H, R> =>
    Effect.map(build, (t) => ({ ...t, resources }));

export const build = Effect.fn(function* <G extends Grade.Grader, R>(
  build: Builder<G, HasPrompt | HasContext | G, R>,
): Effect.fn.Return<Task<G>, TaskError, R> {
  let { metadata, prompt, snapshot, context, gradeContext, graders, resources } = yield* build;

  assertNonNull(metadata);
  assertNonNull(prompt);
  assertNonNull(graders);
  assertNonNull(snapshot);
  assertNonNull(context);

  return {
    metadata,
    prompt,
    snapshot,
    context,
    gradeContext: gradeContext ?? null,
    graders,
    resources: resources ?? null,
  };
});
