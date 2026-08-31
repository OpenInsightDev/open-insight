import * as Sidecar from "./sidecar.ts";
import * as Embed from "./embed.ts";
import { Effect, Match, Option, type Schema } from "effect";
import * as Verif from "./verif.ts";
import { Sandbox } from "@open-insight/core/internal";
import { GradeError } from "./error.ts";
import type { Retry } from "./retry.ts";

export type Variant<Result extends Schema.Constraint> =
  // DataEnum with generic is painful
  | (Embed.Grader<Result> & Readonly<{ _tag: "Embed" }>)
  | (Sidecar.Grader<Result> & Readonly<{ _tag: "TrailSidecar" | "TaskSidecar" }>);

export type Grader<Result extends Schema.Constraint = any> = Variant<Result> &
  Readonly<{
    schema: Result;
    verif: Option.Option<Verif.Verif<Result>>;
  }>;
export type Any = Grader<any>;
export type ResultOf<G> = G extends Grader<infer R> ? R : never;

export type Options<Result extends Schema.Constraint> = Readonly<{
  verif?: Verif.Verif<Result> | null;
}>;

type EmbedOptions<Result extends Schema.Constraint, E = unknown, R = never> = Options<Result> &
  Omit<Embed.Options<Result, E, R>, "grade">;

export const embed = Effect.fn(function* <Result extends Schema.Constraint, E, R>(
  schema: Result,
  grade: Embed.Exec<Result, E, R>,
  options: EmbedOptions<Result, E, R> = {},
) {
  const { verif = null } = options;
  const grader = yield* Embed.make({ grade, ...options });

  return Object.assign(grader, {
    _tag: "Embed" as const,
    schema,
    verif: Option.fromNullishOr(verif),
  });
});

type SidecarOptions<Result extends Schema.Constraint, E = unknown, R = never> = Options<Result> &
  Omit<Sidecar.Options<Result, E, R>, "grade">;

export const sidecar = Effect.fn(function* <Result extends Schema.Constraint, E, R>(
  schema: Result,
  grade: Sidecar.Exec<Result, E, R>,
  options: SidecarOptions<Result, E, R> = {},
) {
  const { verif = null } = options;

  const _tag = Match.value(options.scope ?? "per-trail").pipe(
    Match.when("per-trail", () => "TrailSidecar" as const),
    Match.when("per-task", () => "TaskSidecar" as const),
    Match.exhaustive,
  );

  const grader = yield* Sidecar.make({ grade, ...options });

  return Object.assign(grader, {
    _tag,
    schema,
    verif: Option.fromNullishOr(verif),
  });
});

type RunOptions = Readonly<{
  sandbox: Sandbox.Sandbox;
}>;

export type Run = <R extends Schema.Constraint = any>(
  options: RunOptions,
) => Effect.Effect<R["Type"], GradeError | Retry>;

export const makeRun = Effect.fn(function* <Result extends Schema.Constraint>(
  grader: Grader<Result>,
) {
  const sbxProvider = yield* Sandbox.ProviderService;

  switch (grader._tag) {
    case "Embed": {
      return Effect.fn(function* ({ sandbox }: RunOptions) {
        return yield* grader(sandbox);
      });
    }
    case "TrailSidecar": {
      const snapshot = yield* sbxProvider
        .acquireSnapshot({ template: grader.snapshot, cache: true })
        .pipe(Effect.mapError(GradeError.sandbox));

      return Effect.fn(function* ({ sandbox: agentSbx }: RunOptions) {
        const gradeSbx = yield* sbxProvider
          .runSandbox({ snapshot, resources: grader.resources, cache: false })
          .pipe(Effect.mapError(GradeError.sandbox));

        const context = yield* Sidecar.makeContext({
          agent: agentSbx,
          grade: gradeSbx,
        });
        return yield* grader(context);
      }, Effect.scoped); // self scoped
    }

    case "TaskSidecar": {
      const snapshot = yield* sbxProvider
        .acquireSnapshot({ template: grader.snapshot, cache: true })
        .pipe(Effect.mapError(GradeError.sandbox));

      // grade sandbox are bound to the scope of creation
      // can be used between multiple runs
      const gradeSbx = yield* sbxProvider
        .runSandbox({ snapshot, resources: grader.resources, cache: false })
        .pipe(Effect.mapError(GradeError.sandbox));

      return Effect.fn(function* ({ sandbox: agentSbx }: RunOptions) {
        const context = yield* Sidecar.makeContext({
          agent: agentSbx,
          grade: gradeSbx,
        });
        return yield* grader(context);
      });
    }
  }
});
