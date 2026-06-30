import type * as Grade from "./grade/index.ts";
import type { Contravariant } from "../utils/variant.ts";
import { Sandbox } from "@open-insight/core/internal";
import { type Brand, Effect, Schema } from "effect";
import { Prompt } from "effect/unstable/ai";
import type { TaskError } from "./error.ts";

export type ID = string;

export const MetadataSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
});
export type Metadata = Schema.Schema.Type<typeof MetadataSchema>;

export type Task<G extends Grade.Grader = Grade.Grader> = Readonly<{
  metadata: Metadata;

  graders: Grade.Map<G>;
  prompt: ReadonlyArray<Prompt.UserMessage>;

  snapshot: Sandbox.Snapshot.Snapshot;
  context: Sandbox.Context.Mode;

  resources: Sandbox.ResourceLimits | null;

  readonly _grader?: () => G;
}>;

export type BuiltTask<T extends Task = Task> = Effect.Effect<T, TaskError>;
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
  (context: Sandbox.Context.Mode) =>
  <G extends Grade.Grader, H, R>(build: Builder<G, H, R>): Builder<G, H | HasContext, R> =>
    Effect.map(build, (t) => ({ ...t, context }));

type HasSnapshot = Brand.Brand<"snapshot">;
export const withSnapshot =
  (snapshot: Sandbox.Snapshot.Snapshot) =>
  <G extends Grade.Grader, H, R>(build: Builder<G, H, R>): Builder<G, H | HasSnapshot, R> =>
    Effect.map(build, (t) => ({ ...t, snapshot }));

export const withGrader =
  <N extends string, T>(name: N, exec: Grade.Exec<T>) =>
  <G extends Grade.Grader, H, R>(
    build: Grade.Grader<N, T> extends G ? Builder<G, H, R> : never,
  ): Builder<G, H | Grade.Grader<N, T>, R> =>
    Effect.map(build, (t) => ({
      ...t,
      graders: Object.assign({}, t.graders, { [name]: exec }),
    }));

export const withResources =
  (resources: Sandbox.ResourceLimits) =>
  <G extends Grade.Grader, H, R>(build: Builder<G, H, R>): Builder<G, H, R> =>
    Effect.map(build, (t) => ({ ...t, resources }));

export const build = <G extends Grade.Grader, R>(
  build: Builder<G, HasPrompt | HasContext | HasSnapshot | G, R>,
): Effect.Effect<Task<G>, TaskError, R> => build as Effect.Effect<Task<G>, TaskError, R>;
