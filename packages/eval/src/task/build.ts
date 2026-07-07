import type * as Grade from "./grade/index.ts";
import { Sandbox } from "@open-insight/core/internal";
import { Effect, Schema, type Scope } from "effect";
import { Prompt } from "effect/unstable/ai";
import { TaskError } from "./error.ts";

export type ID = string;
export type TypeId = "~open-insight/eval/task";
export const TypeId: TypeId = "~open-insight/eval/task";

export class Metadata extends Schema.Class<Metadata>("TaskMetadata")({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  keywords: Schema.NullOr(Schema.Array(Schema.String)),
  authors: Schema.NullOr(Schema.Array(Schema.String)),
  extra: Schema.NullOr(Schema.Record(Schema.String, Schema.Json)),
}) {}

export type Task<
  G extends Schema.JsonObject = any,
  Extra extends Schema.JsonObject = any,
> = Metadata &
  Readonly<{
    prompt: ReadonlyArray<Prompt.UserMessage>;
    grader: Grade.Grader<G>;
    snapshot: Sandbox.Snapshot.Snapshot;
    context: Sandbox.Snapshot.Context.Context;
    resources: Sandbox.ResourceLimits | null;
  }> & {
    [TypeId]: TypeId;
    _G?: G;
    _Extra?: Extra;
  };

export type ExtraOf<T> = T extends Task<infer _G, infer Extra> ? Extra : never;
export type GradeResultOf<T> = T extends Task<infer G, infer _Extra> ? G : never;

export type Tasks<T extends Task = Task> = ReadonlyArray<Effect.Effect<T, TaskError, Scope.Scope>>;

type Options<T extends Task = Task> = Readonly<{
  name: string;
  description?: string;
  keywords?: ReadonlyArray<string>;
  authors?: ReadonlyArray<string>;
  extra?: ExtraOf<T>;

  prompt: ReadonlyArray<Prompt.UserMessage>;
  grader: Grade.Grader<GradeResultOf<T>>;
  snapshot: Sandbox.Snapshot.Snapshot;
  context: Sandbox.Snapshot.Context.Context;
  resources?: Sandbox.ResourceLimits;
}>;

export const make = <G extends Schema.JsonObject = any, Extra extends Schema.JsonObject = any>({
  resources,
  extra,
  ...rest
}: Options<Task<G, Extra>>): Task<G, Extra> => ({
  [TypeId]: TypeId,
  authors: rest.authors ?? null,
  keywords: rest.keywords ?? null,
  description: rest.description ?? null,
  extra: extra ?? null,
  resources: resources ?? Sandbox.ResourceLimits.default,
  ...rest,
  // HACK: TypeScript do not support `Exact` type
  // we assume no one would add extra fields to the T
});
