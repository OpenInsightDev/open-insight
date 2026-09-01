import * as Sidecar from "./sidecar.ts";
import * as Embed from "./embed.ts";
import { Effect, FileSystem, flow, Match, Option, Path, Scope, type Schema } from "effect";
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

type EmbedOptions<Result extends Schema.Constraint> = Options<Result> &
  Omit<Embed.Options<Result>, "grade">;

export const embed = <Result extends Schema.Constraint>(
  schema: Result,
  grade: Embed.Options<Result>["grade"],
  options: EmbedOptions<Result> = {},
) => {
  const { verif = null } = options;
  const grader = Embed.make({ grade, ...options });

  return Object.assign(grader, {
    _tag: "Embed" as const,
    schema,
    verif: Option.fromNullishOr(verif),
  });
};

type SidecarOptions<Result extends Schema.Constraint> = Options<Result> &
  Omit<Sidecar.Options<Result>, "grade">;

export const sidecar = <Result extends Schema.Constraint>(
  schema: Result,
  grade: Sidecar.Exec<Result>,
  options: SidecarOptions<Result> = {},
) => {
  const { verif = null } = options;

  const _tag = Match.value(options.scope ?? "per-trail").pipe(
    Match.when("per-trail", () => "TrailSidecar" as const),
    Match.when("per-task", () => "TaskSidecar" as const),
    Match.exhaustive,
  );

  const grader = Sidecar.make({ grade, ...options });

  return Object.assign(grader, {
    _tag,
    schema,
    verif: Option.fromNullishOr(verif),
  });
};

export type Run<R extends Schema.Constraint = any> = (
  sandbox: Sandbox.Sandbox,
) => Effect.Effect<R["Type"], GradeError | Retry>;

export const makeRun = Effect.fn(function* <Result extends Schema.Constraint>(
  grader: Grader<Result>,
): Effect.fn.Return<
  Run<Result>,
  GradeError,
  Sandbox.ProviderService | FileSystem.FileSystem | Path.Path | Scope.Scope
> {
  const sbxProvider = yield* Sandbox.ProviderService;
  const ctx = yield* Effect.context<FileSystem.FileSystem | Path.Path>();

  switch (grader._tag) {
    case "Embed": {
      return Effect.fn(function* (sandbox) {
        return yield* grader(sandbox);
      });
    }
    case "TrailSidecar": {
      const snapshot = yield* sbxProvider
        .acquireSnapshot({ template: grader.snapshot, cache: true })
        .pipe(Effect.mapError(GradeError.sandbox));

      return Effect.fn(
        function* (agentSbx) {
          const gradeSbx = yield* sbxProvider
            .runSandbox({ snapshot, resources: grader.resources, cache: false })
            .pipe(Effect.mapError(GradeError.sandbox));

          const context = yield* Sidecar.makeContext({
            agent: agentSbx,
            grade: gradeSbx,
          });
          return yield* grader(context);
        },
        flow(Effect.provide(ctx), Effect.scoped),
      ); // self scoped
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

      return Effect.fn(function* (agentSbx) {
        const context = yield* Sidecar.makeContext({
          agent: agentSbx,
          grade: gradeSbx,
        });
        return yield* grader(context);
      }, Effect.provide(ctx));
    }
  }
});
