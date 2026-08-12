import * as Sidecar from "./sidecar.ts";
import * as Base from "./base.ts";
import { Data, Effect, FileSystem, Match, Path, Scope } from "effect";
import { Prompt, Resource, Sandbox, Snapshot } from "@open-insight/core/internal";
import type { Verif } from "./verif.ts";
import type { AnyResult } from "./result.ts";
import * as Retry from "./retry.ts";
import { GradeError } from "./error.ts";

export type Grader<R extends AnyResult = AnyResult> = Data.TaggedEnum<{
  Base: Base.Grader<R>;
  TrailSidecar: Sidecar.Grader<R>;
  TaskSidecar: Sidecar.Grader<R>;
}>;
export const Grader = Data.taggedEnum<Grader>();

export const make =
  <R extends AnyResult>(schema: R) =>
  (grade: Base.Exec<R>, verif: Verif<R> | null = null) =>
    Grader.Base({ schema, grade, verif });

export const makeSidecar =
  <R extends AnyResult>(schema: R) =>
  (
    grade: Sidecar.Exec<R>,
    snapshot: Snapshot.Template,
    {
      scope = "per-trail",
      resources = Resource.make(),
      verif = null,
      concurrency = 1,
    }: {
      scope?: Sidecar.SandboxScope;
      resources?: Resource.Resources;
      verif?: Verif<R> | null;
      concurrency?: number;
    } = {},
  ) => {
    const options = { schema, grade, snapshot, resources, verif, scope, concurrency };
    return Match.value(scope).pipe(
      Match.when("per-task", () => Grader.TaskSideCar(options)),
      Match.when("per-trail", () => Grader.TrailSidecar(options)),
      Match.exhaustive,
    );
  };

type RunOptions = Readonly<{
  sandbox: Sandbox.Sandbox;
  trajectory: Prompt.Trajectory;
}>;

export type RunGrader<R extends AnyResult = AnyResult> = (
  options: RunOptions,
) => Effect.Effect<
  R["Type"],
  GradeError | Retry.Retry,
  FileSystem.FileSystem | Path.Path | Scope.Scope
>;

export const createRunner = Effect.fn(function* <R extends AnyResult = AnyResult>(
  grader: Grader<R>,
): Effect.fn.Return<RunGrader<R>, GradeError, Scope.Scope | Sandbox.ProviderService> {
  const scope = yield* Scope.Scope;
  const sbxProvider = yield* Sandbox.ProviderService;

  return yield* Grader.$match(grader, {
    Base: Effect.fn(function* (grader) {
      return Effect.fn(function* ({ sandbox, trajectory }: RunOptions) {
        return Base.run(grader)({ sandbox, trajectory });
      });
    }),
    TrailSidecar: Effect.fn(function* (grader) {
      const { snapshot: template, resources } = grader;

      const snapshot = yield* sbxProvider
        .acquireSnapshot({ template, cache: true })
        .pipe(Effect.mapError(GradeError.sandbox))
        .pipe(Effect.provideService(Scope.Scope, scope));

      return Effect.fn(
        function* ({ sandbox: agentSbx, trajectory }: RunOptions) {
          const gradeSbx = yield* sbxProvider
            .runSandbox({ snapshot, resources, cache: false })
            .pipe(Effect.mapError(GradeError.sandbox));

          return Sidecar.run(grader)({ agent: agentSbx, grade: gradeSbx, trajectory });
        },
        (effect) => effect.pipe(Effect.scoped),
      );
    }),
    TaskSidecar: Effect.fn(function* (grader) {
      const { snapshot: template, resources } = grader;

      const snapshot = yield* sbxProvider
        .acquireSnapshot({ template, cache: true })
        .pipe(Effect.mapError(GradeError.sandbox))
        .pipe(Effect.provideService(Scope.Scope, scope));

      // grade sandbox are bound to the scope of creation
      // can be used between multiple runs
      const gradeSbx = yield* sbxProvider
        .runSandbox({ snapshot, resources, cache: true })
        .pipe(Effect.mapError(GradeError.sandbox))
        .pipe(Effect.provideService(Scope.Scope, scope));

      return Effect.fn(function* ({ sandbox: agentSbx, trajectory }: RunOptions) {
        return Sidecar.run(grader)({ agent: agentSbx, grade: gradeSbx, trajectory });
      });
    }),
  });
});

export * from "./error.ts";
export * from "./retry.ts";
export * from "./result.ts";
export * as Base from "./base.ts";
export * as Sidecar from "./sidecar.ts";
export * as Verif from "./verif.ts";
export * from "./builtin/index.ts";
