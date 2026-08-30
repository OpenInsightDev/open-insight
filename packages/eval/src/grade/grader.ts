import * as Sidecar from "./sidecar.ts";
import * as Embed from "./embed.ts";
import type { Tool } from "effect/unstable/ai";
import { Effect, Match, Option, type Schema } from "effect";
import * as Verif from "./verif.ts";
import type { Sandbox, Trajectory } from "@open-insight/core/internal";

export type Variant<Result extends Schema.Constraint, Tools extends Record<string, Tool.Any>> =
  // DataEnum with generic is painful
  | Readonly<{
      _tag: "Embed";
      grader: Embed.Grader<Result, Tools>;
    }>
  | Readonly<{
      _tag: "TrailSidecar";
      grader: Sidecar.Grader<Result, Tools>;
    }>
  | Readonly<{
      _tag: "TaskSidecar";
      grader: Sidecar.Grader<Result, Tools>;
    }>;

export type Grader<
  Result extends Schema.Constraint = any,
  Tools extends Record<string, Tool.Any> = any,
> = Variant<Result, Tools> &
  Readonly<{
    schema: Result;
    verif: Option.Option<Verif.Verif<Result>>;
  }>;

export type VerifOptions<Result extends Schema.Constraint> = Readonly<{
  verif?: Verif.Verif<Result> | null;
}>;

type EmbedOptions<
  Result extends Schema.Constraint = any,
  Tools extends Record<string, Tool.Any> = any,
  E = unknown,
  R = never,
> = Omit<Embed.Options<Result, Tools, E, R>, "grade"> & VerifOptions<Result>;

export const embed = Effect.fn(function* <
  Result extends Schema.Constraint,
  Tools extends Record<string, Tool.Any>,
  E,
  R,
>(schema: Result, grade: Embed.Exec<Result, Tools, E, R>, options: EmbedOptions = {}) {
  return {
    _tag: "Embed",
    schema,
    grader: yield* Embed.make({ grade, ...options }),
    verif: Option.fromNullishOr(options.verif),
  } satisfies Grader<Result, Tools>;
});

type SidecarOptions<
  Result extends Schema.Constraint = any,
  Tools extends Record<string, Tool.Any> = any,
  E = unknown,
  R = never,
> = Omit<Sidecar.Options<Result, Tools, E, R>, "grade"> & VerifOptions<Result>;

export const sidecar = Effect.fn(function* <
  Result extends Schema.Constraint,
  Tools extends Record<string, Tool.Any>,
  E,
  R,
>(schema: Result, grade: Sidecar.Exec<Result, Tools, E, R>, options: SidecarOptions = {}) {
  const _tag = Match.value(options.scope ?? "per-trail").pipe(
    Match.when("per-trail", () => "TrailSidecar" as const),
    Match.when("per-task", () => "TaskSidecar" as const),
    Match.exhaustive,
  );

  return {
    _tag,
    schema,
    grader: yield* Sidecar.make({ grade, ...options }),
    verif: Option.fromNullishOr(options.verif),
  } satisfies Grader<Result, Tools>;
});

type RunOptions = Readonly<{
  sandbox: Sandbox.Sandbox;
  trajectory: Trajectory.Trajectory<any>;
}>;
