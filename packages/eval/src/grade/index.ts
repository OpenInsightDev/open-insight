import * as Sidecar from "./sidecar.ts";
import * as Embed from "./embed.ts";
import { Context, Data, Effect, FileSystem, Layer, Match, Path, Schema, Scope } from "effect";
import { Prompt, Resource, Sandbox, Snapshot } from "@open-insight/core/internal";
import type { Verif } from "./verif.ts";
import * as Retry from "./retry.ts";
import { GradeError } from "./error.ts";

export type Variant<R extends Schema.Constraint> = Data.TaggedEnum<{
  Embed: Embed.Grader<R>;
  TrailSidecar: Sidecar.Grader<R>;
  TaskSidecar: Sidecar.Grader<R>;
}>;
export const Variant = <R extends Schema.Constraint>() => Data.taggedEnum<Variant<R>>();

export type Grader<R extends Schema.Constraint = any> = Variant<R> & Readonly<{ schema: R }>;

export type EmbedOptions<R extends Schema.Constraint = any> = Readonly<{
  verif?: Verif<R> | null;
}>;
/**
 * Creates an embed grader.
 *
 * This grader runs the grading logic in the same sandbox as the agent.
 */
export const embed = <R extends Schema.Constraint>(
  schema: R,
  grade: Embed.Exec<R>,
  { verif = null }: EmbedOptions<R> = {},
) => Object.assign(Variant<R>().Embed({ grade, verif }), { schema }) satisfies Grader<R>;

export type SidecarOptions<R extends Schema.Constraint = any> = Readonly<{
  snapshot?: Snapshot.Template;
  verif?: Verif<R> | null;
  scope?: Sidecar.SandboxScope;
  resources?: Resource.Resources;
  concurrency?: number;
}>;
/**
 * Creates a sidecar grader.
 *
 * This grader runs the grading logic in a separate grading sandbox.
 */
export const sidecar =
  <R extends Schema.Constraint>(schema: R) =>
  (
    grade: Sidecar.Exec<R>,
    {
      snapshot = Snapshot.Alpine,
      verif = null,
      scope = "per-trail",
      resources = Resource.make(),
      concurrency = 1,
    }: SidecarOptions<R> = {},
  ): Variant<R> => {
    const options = { grade, snapshot, verif, scope, resources, concurrency };
    return Object.assign(
      Match.value(scope).pipe(
        Match.when("per-task", () => Variant<R>().TaskSidecar(options)),
        Match.when("per-trail", () => Variant<R>().TrailSidecar(options)),
        Match.exhaustive,
      ),
      { schema },
    ) satisfies Grader<R>;
  };

type RunOptions = Readonly<{
  sandbox: Sandbox.Sandbox;
  trajectory: Prompt.Trajectory;
}>;

export type RunGrader = <R extends Schema.Constraint = any>(
  options: RunOptions,
) => Effect.Effect<
  R["Type"],
  GradeError | Retry.Retry,
  FileSystem.FileSystem | Path.Path | R["DecodingServices"]
>;

export class RunService extends Context.Service<
  RunService,
  {
    run<R extends Schema.Constraint>(
      options: RunOptions,
    ): Effect.Effect<
      R["Type"],
      GradeError | Retry.Retry,
      FileSystem.FileSystem | Path.Path | R["DecodingServices"]
    >;
  }
>()("RunService") {}

export const layerFrom = <R extends Schema.Constraint>(grader: Grader<R>) =>
  Layer.effect(
    RunService,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const sbxProvider = yield* Sandbox.ProviderService;

      const schema = grader.schema;
      const decodeResult = Schema.decodeEffect(schema);

      const run = yield* Variant().$match(grader, {
        Embed: Effect.fn(function* (grader) {
          return Effect.fn(function* ({ sandbox, trajectory }: RunOptions) {
            const result = yield* Embed.run(grader)({ sandbox, trajectory });
            return yield* decodeResult(result).pipe(Effect.mapError(GradeError.result));
          });
        }),
        TrailSidecar: Effect.fn(function* (grader) {
          const { snapshot: template, resources } = grader;

          const snapshot = yield* sbxProvider
            .acquireSnapshot({ template, cache: true })
            .pipe(Effect.mapError(GradeError.sandbox))
            .pipe(Effect.provideService(Scope.Scope, scope));

          return Effect.fn(function* ({ sandbox: agentSbx, trajectory }: RunOptions) {
            const gradeSbx = yield* sbxProvider
              .runSandbox({ snapshot, resources, cache: false })
              .pipe(Effect.mapError(GradeError.sandbox));

            const result = yield* Sidecar.run(grader)({
              agent: agentSbx,
              grade: gradeSbx,
              trajectory,
            });
            return yield* decodeResult(result).pipe(Effect.mapError(GradeError.result));
          }, Effect.scoped);
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
            const result = yield* Sidecar.run(grader)({
              agent: agentSbx,
              grade: gradeSbx,
              trajectory,
            });
            return yield* decodeResult(result).pipe(Effect.mapError(GradeError.result));
          });
        }),
      });

      return { run };
    }),
  );

export * from "./error.ts";
export * from "./retry.ts";
export * as Base from "./embed.ts";
export * as Sidecar from "./sidecar.ts";
export * as Verif from "./verif.ts";
