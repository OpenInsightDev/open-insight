import * as Sidecar from "./sidecar.ts";
import * as Embed from "./embed.ts";
import { Context, Data, Effect, FileSystem, Layer, Match, Path, Scope } from "effect";
import { Prompt, Resource, Sandbox, Snapshot } from "@open-insight/core/internal";
import type { Verif } from "./verif.ts";
import { decodeResult, type AnyResult } from "./result.ts";
import * as Retry from "./retry.ts";
import { GradeError } from "./error.ts";

export type Variant<R extends AnyResult> = Data.TaggedEnum<{
  Embed: Embed.Grader<R>;
  TrailSidecar: Sidecar.Grader<R>;
  TaskSidecar: Sidecar.Grader<R>;
}>;
export const Variant = <R extends AnyResult>() => Data.taggedEnum<Variant<R>>();

export type Grader<R extends AnyResult = AnyResult> = Readonly<{
  schema: R;
  variant: Variant<R>;
}>;

export type EmbedOptions<R extends AnyResult = AnyResult> = Readonly<{
  verif?: Verif<R> | null;
}>;
export const embed = <R extends AnyResult>(
  grade: Embed.Exec<R>,
  { verif = null }: EmbedOptions<R> = {},
) => Variant<R>().Embed({ grade, verif });

export type SidecarOptions<R extends AnyResult = AnyResult> = Readonly<{
  snapshot?: Snapshot.Template;
  verif?: Verif<R> | null;
  scope?: Sidecar.SandboxScope;
  resources?: Resource.Resources;
  concurrency?: number;
}>;
export const sidecar = <R extends AnyResult>(
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
  return Match.value(scope).pipe(
    Match.when("per-task", () => Variant<R>().TaskSidecar(options)),
    Match.when("per-trail", () => Variant<R>().TrailSidecar(options)),
    Match.exhaustive,
  );
};

type RunOptions = Readonly<{
  sandbox: Sandbox.Sandbox;
  trajectory: Prompt.Trajectory;
}>;

export type RunGrader = <R extends AnyResult = AnyResult>(
  options: RunOptions,
) => Effect.Effect<
  R["Type"],
  GradeError | Retry.Retry,
  FileSystem.FileSystem | Path.Path | R["DecodingServices"]
>;

export class RunService extends Context.Service<
  RunService,
  {
    run<R extends AnyResult = AnyResult>(
      options: RunOptions,
    ): Effect.Effect<
      R["Type"],
      GradeError | Retry.Retry,
      FileSystem.FileSystem | Path.Path | R["DecodingServices"]
    >;
  }
>()("RunService") {}

export const layerFrom = ({ schema, variant }: Grader) =>
  Layer.effect(
    RunService,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const sbxProvider = yield* Sandbox.ProviderService;

      const run = yield* Variant().$match(variant, {
        Embed: Effect.fn(function* (grader) {
          return Effect.fn(function* ({ sandbox, trajectory }: RunOptions) {
            const result = yield* Embed.run(grader)({ sandbox, trajectory });
            return yield* decodeResult(schema, result);
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
            return yield* decodeResult(schema, result);
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
            return yield* decodeResult(schema, result);
          });
        }),
      });

      return { run };
    }),
  );

export * from "./error.ts";
export * from "./retry.ts";
export * from "./result.ts";
export * as Base from "./embed.ts";
export * as Sidecar from "./sidecar.ts";
export * as Verif from "./verif.ts";
