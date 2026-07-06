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
  description: Schema.optional(Schema.String),
  keywords: Schema.optional(Schema.Array(Schema.String)),
  authors: Schema.optional(Schema.Array(Schema.String)),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
}) {}

export type Task<
  G extends Schema.Struct.Fields = never,
  Extra extends Schema.Struct.Fields = never,
> = Metadata &
  Readonly<{
    prompt: ReadonlyArray<Prompt.UserMessage>;
    grader: Grade.Grader<G>;
    snapshot: Sandbox.Snapshot.Snapshot;
    context: Sandbox.Context.Context;
    resources: Sandbox.ResourceLimits | null;
    extra: Extra | null; // override metadata.extra with typed def
  }> & {
    [TypeId]: TypeId;
    _G?: G;
    _Extra?: Extra;
  };

export type GradeFieldsOf<T> = T extends Task<infer G, infer _> ? G : never;
export type GradeResultOf<T> = T extends Task<infer G, infer _> ? Grade.Result<G> : never;
export type ExtraFieldsOf<T> = T extends Task<infer _, infer Extra> ? Extra : never;
export type ExtraOf<T> =
  T extends Task<infer _, infer Extra> ? Schema.Schema.Type<Schema.Struct<Extra>> : never;

export type Tasks<T extends Task = Task> = ReadonlyArray<Effect.Effect<T, TaskError, Scope.Scope>>;

type Options<T extends Task> = Metadata &
  Readonly<{
    prompt: ReadonlyArray<Prompt.UserMessage>;
    grader: Grade.Grader<GradeFieldsOf<T>>;
    snapshot: Sandbox.Snapshot.Snapshot;
    context: Sandbox.Context.Context;
    resources?: Sandbox.ResourceLimits;
    extra?: ExtraOf<T>;
  }>;

export const make = <T extends Task>({ resources, extra, ...rest }: Options<T>): T =>
  ({
    [TypeId]: TypeId,
    resources: resources ?? Sandbox.ResourceLimits.default,
    extra: extra ?? null,
    ...rest,
  }) as T;
