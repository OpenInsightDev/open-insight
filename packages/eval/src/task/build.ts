import type * as Grade from "./grade/index.ts";
import * as Verif from "./verif/index.ts";
import { Sandbox, Snapshot } from "@open-insight/core/internal";
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

export type Options<
  G extends Schema.JsonObject = any,
  Extra extends Schema.JsonObject = never,
> = Readonly<
  {
    name: string;
    prompt: ReadonlyArray<Prompt.UserMessage>;
    grader: Grade.Grader<G>;
    verifier?: Verif.Verifier<G>;
    snapshot: Snapshot.Snapshot;

    description?: string;
    keywords?: ReadonlyArray<string>;
    authors?: ReadonlyArray<string>;
    resources?: Sandbox.Resources;
  } &
    // if extra not specified, we don't require it to be present
    ([Extra] extends [never] ? { extra?: never } : { extra: Extra })
>;

export class Task<G extends Schema.JsonObject = any, Extra extends Schema.JsonObject = any> {
  static readonly TypeId: TypeId = TypeId;

  metadata: Metadata;
  resources: Sandbox.Resources;
  prompt: ReadonlyArray<Prompt.UserMessage>;
  grader: Grade.Grader<G>;
  verifier?: Verif.Verifier<G>;
  snapshot: Snapshot.Snapshot;

  constructor({
    name,
    prompt,
    grader,
    verifier,
    snapshot,
    description,
    keywords,
    authors,
    extra,
    resources,
  }: Options<G, Extra>) {
    this.prompt = prompt;
    this.grader = grader;
    this.verifier = verifier;
    this.snapshot = snapshot;
    this.metadata = Metadata.make({
      name,
      description: description ?? null,
      keywords: keywords ?? null,
      authors: authors ?? null,
      extra: extra ?? null,
    });
    this.resources = resources ?? new Sandbox.Resources();
  }

  get name(): string {
    return this.metadata.name;
  }

  get extra(): Extra | null {
    return this.metadata.extra as Extra | null;
  }

  [Symbol.dispose](): void {}
}

export type ExtraOf<T> = T extends Task<infer _G, infer Extra> ? Extra : never;
export type GradeResultOf<T> = T extends Task<infer G, infer _Extra> ? G : never;

export type Tasks<T extends Task = Task> = ReadonlyArray<Effect.Effect<T, TaskError, Scope.Scope>>;
