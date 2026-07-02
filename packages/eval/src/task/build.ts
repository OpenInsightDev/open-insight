import type * as Grade from "./grade/index.ts";
import { Sandbox } from "@open-insight/core/internal";
import { Effect, Schema, type Scope } from "effect";
import { Prompt } from "effect/unstable/ai";
import { TaskError } from "./error.ts";

export type ID = string;

export class Metadata extends Schema.Class<Metadata>("TaskMetadata")({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  keywords: Schema.optional(Schema.Array(Schema.String)),
  authors: Schema.optional(Schema.Array(Schema.String)),
}) {}

export type Task<G extends Grade.Grader = Grade.Grader> = Metadata &
  Readonly<{
    graders: Grade.Map<G>;
    prompt: ReadonlyArray<Prompt.UserMessage>;

    context: Sandbox.Context.Context;

    snapshot: Sandbox.Snapshot.Snapshot;

    resources: Sandbox.ResourceLimits | null;
  }> & { _G?: G };

export type GraderOf<T> = T extends Task<infer G> ? G : never;

export type Tasks<T extends Task = Task> = ReadonlyArray<Effect.Effect<T, TaskError, Scope.Scope>>;

type Options<T extends Task> = Metadata &
  Readonly<{
    prompt: ReadonlyArray<Prompt.UserMessage>;
    graders: Grade.Map<GraderOf<T>>;
    context: Sandbox.Context.Context;
    snapshot: Sandbox.Snapshot.Snapshot;
    resources?: Sandbox.ResourceLimits;
  }>;

export const make = <T extends Task>({
  prompt,
  graders,
  context,
  snapshot,
  resources,
  ...metadata
}: Options<T>): Task<GraderOf<T>> => ({
  ...metadata,
  prompt,
  graders,
  context,
  snapshot,
  resources: resources ?? null,
});
