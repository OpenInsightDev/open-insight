import * as Sidecar from "./sidecar.ts";
import * as Embed from "./embed.ts";
import { Toolkit, type Tool } from "effect/unstable/ai";
import { Effect, Match, Option, type Schema } from "effect";
import * as Verif from "./verif.ts";
import { Sandbox, type Trajectory } from "@open-insight/core/internal";
import { GradeError } from "./error.ts";
import type { Retry } from "./retry.ts";

export type Variant<Result extends Schema.Constraint, Tools extends Record<string, Tool.Any>> =
  // DataEnum with generic is painful
  | (Embed.Grader<Result, Tools> & Readonly<{ _tag: "Embed" }>)
  | (Sidecar.Grader<Result, Tools> & Readonly<{ _tag: "TrailSidecar" | "TaskSidecar" }>);

export type Grader<
  Result extends Schema.Constraint = any,
  Tools extends Record<string, Tool.Any> = any,
> = Variant<Result, Tools> &
  Readonly<{
    schema: Result;
    verif: Option.Option<Verif.Verif<Result>>;
    toolkit: Toolkit.Toolkit<Tools>;
  }>;
export type Any = Grader<any, any>;
export type ResultOf<G> = G extends Grader<infer R, any> ? R : never;
export type ToolsOf<G> = G extends Grader<any, infer T> ? T : never;

export type Options<
  Result extends Schema.Constraint,
  Toolkits extends ReadonlyArray<Toolkit.Any>,
> = Readonly<{
  verif?: Verif.Verif<Result> | null;
  toolkits?: Toolkits;
}>;

type EmbedOptions<
  Result extends Schema.Constraint,
  Toolkits extends ReadonlyArray<Toolkit.Any>,
  E = unknown,
  R = never,
> = Options<Result, Toolkits> &
  Omit<Embed.Options<Result, Toolkit.MergedTools<Toolkits>, E, R>, "grade">;

export const embed = Effect.fn(function* <
  Result extends Schema.Constraint,
  Toolkits extends ReadonlyArray<Toolkit.Any>,
  E,
  R,
>(
  schema: Result,
  grade: Embed.Exec<Result, Toolkit.MergedTools<Toolkits>, E, R>,
  options: EmbedOptions<Result, Toolkits> = {},
) {
  const { verif = null, toolkits = [] } = options;
  const grader = yield* Embed.make({ grade, ...options });

  return Object.assign(grader, {
    _tag: "Embed",
    schema,
    verif: Option.fromNullishOr(verif),
    toolkit: Toolkit.merge(...toolkits),
  });
});

type SidecarOptions<
  Result extends Schema.Constraint,
  Toolkits extends ReadonlyArray<Toolkit.Any>,
  E = unknown,
  R = never,
> = Options<Result, Toolkits> &
  Omit<Sidecar.Options<Result, Toolkit.MergedTools<Toolkits>, E, R>, "grade">;

export const sidecar = Effect.fn(function* <
  Result extends Schema.Constraint,
  Toolkits extends ReadonlyArray<Toolkit.Any>,
  E,
  R,
>(
  schema: Result,
  grade: Sidecar.Exec<Result, Toolkit.MergedTools<Toolkits>, E, R>,
  options: SidecarOptions<Result, Toolkits> = {},
) {
  const { verif = null, toolkits = [] } = options;

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
    toolkit: Toolkit.merge(...toolkits),
  });
});

type RunOptions<Tools extends Record<string, Tool.Any>> = Readonly<{
  sandbox: Sandbox.Sandbox;
  trajectory: Trajectory.Trajectory<Tools>;
}>;

export type Run = <R extends Schema.Constraint = any, Tools extends Record<string, Tool.Any> = any>(
  options: RunOptions<Tools>,
) => Effect.Effect<R["Type"], GradeError | Retry>;

export const makeRun = Effect.fn(function* <
  Result extends Schema.Constraint,
  Tools extends Record<string, Tool.Any>,
>(grader: Grader<Result, Tools>) {
  const sbxProvider = yield* Sandbox.ProviderService;

  switch (grader._tag) {
    case "Embed": {
      return Effect.fn(function* ({ sandbox, trajectory }: RunOptions<Tools>) {
        return yield* grader({ ...sandbox, trajectory });
      });
    }
    case "TrailSidecar": {
      const snapshot = yield* sbxProvider
        .acquireSnapshot({ template: grader.snapshot, cache: true })
        .pipe(Effect.mapError(GradeError.sandbox));

      return Effect.fn(function* ({ sandbox: agentSbx, trajectory }: RunOptions<Tools>) {
        const gradeSbx = yield* sbxProvider
          .runSandbox({ snapshot, resources: grader.resources, cache: false })
          .pipe(Effect.mapError(GradeError.sandbox));

        const context = yield* Sidecar.makeContext({
          agent: agentSbx,
          grade: gradeSbx,
          trajectory,
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

      return Effect.fn(function* ({ sandbox: agentSbx, trajectory }: RunOptions<Tools>) {
        const context = yield* Sidecar.makeContext({
          agent: agentSbx,
          grade: gradeSbx,
          trajectory,
        });
        return yield* grader(context);
      });
    }
  }
});
