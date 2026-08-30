import * as Sidecar from "./sidecar.ts";
import * as Embed from "./embed.ts";
import { Context, Data, Effect, FileSystem, Layer, Match, Path, Schema, Scope } from "effect";
import { Resource, Sandbox, Snapshot, Trajectory } from "@open-insight/core/internal";
import * as Verif from "./verif.ts";
import * as Retry from "./retry.ts";
import { GradeError } from "./error.ts";
import type { Tool } from "effect/unstable/ai";

// export type Variant<
//   Result extends Schema.Constraint,
//   Tools extends Record<string, Tool.Any> = any,
// > = Data.TaggedEnum<{
//   Embed: Embed.Grader<Result, Tools>;
//   TrailSidecar: Sidecar.Grader<Result, Tools>;
//   TaskSidecar: Sidecar.Grader<Result, Tools>;
// }>;
// export const Variant = <
//   Result extends Schema.Constraint,
//   Tools extends Record<string, Tool.Any> = any,
// >() => Data.taggedEnum<Variant<Result, Tools>>();

// export type Grader<
//   Result extends Schema.Constraint = any,
//   Tools extends Record<string, Tool.Any> = any,
// > = Variant<Result, Tools> & Readonly<{ schema: Result }>;

// export type EmbedOptions<
//   Result extends Schema.Constraint = any,
//   VE = unknown,
//   VR = never,
//   Tools extends Record<string, Tool.Any> = any,
// > = Readonly<{
//   verif?: Readonly<{
//     exec: Verif.Exec<VE, VR, Tools>;
//     expect: Partial<Result["Encoded"]>;
//   }> | null;
// }>;
// /**
//  * Creates an embed grader.
//  *
//  * This grader runs the grading logic in the same sandbox as the agent.
//  */
// export const embed = Effect.fn(function* <
//   Result extends Schema.Constraint,
//   E,
//   R,
//   VE = unknown,
//   VR = never,
//   Tools extends Record<string, Tool.Any> = any,
// >(
//   schema: Result,
//   grade: Embed.Exec<Result, E, R, Tools>,
//   { verif = null }: EmbedOptions<Result, VE, VR, Tools> = {},
// ) {
//   const gradeContext = yield* Effect.context<R>();
//   const verifContext = yield* Effect.context<VR>();

//   return Object.assign(
//     Variant<Result, Tools>().Embed({
//       grade: (context) =>
//         grade(context).pipe(Effect.provide(gradeContext), Effect.mapError(Retry.mapError)),
//       verif:
//         verif === null
//           ? null
//           : {
//               exec: (context) =>
//                 verif.exec(context).pipe(
//                   Effect.provide(verifContext),
//                   Effect.mapError((cause) =>
//                     cause instanceof GradeError ? cause : GradeError.verify(cause),
//                   ),
//                 ),
//               expect: verif.expect,
//             },
//     }),
//     { schema },
//   ) satisfies Grader<Result, Tools>;
// });

// export type SidecarOptions<
//   Result extends Schema.Constraint = any,
//   VE = unknown,
//   VR = never,
//   Tools extends Record<string, Tool.Any> = any,
// > = Readonly<{
//   snapshot?: Snapshot.Template;
//   verif?: Readonly<{
//     exec: Verif.Exec<VE, VR, Tools>;
//     expect: Partial<Result["Encoded"]>;
//   }> | null;
//   scope?: Sidecar.SandboxScope;
//   resources?: Resource.Resources;
//   concurrency?: number;
// }>;
// /**
//  * Creates a sidecar grader.
//  *
//  * This grader runs the grading logic in a separate grading sandbox.
//  */
// export const sidecar = <Result extends Schema.Constraint>(schema: Result) =>
//   Effect.fn(function* <
//     E,
//     R,
//     VE = unknown,
//     VR = never,
//     Tools extends Record<string, Tool.Any> = any,
//   >(
//     grade: Sidecar.Exec<Result, E, R, Tools>,
//     {
//       snapshot = Snapshot.Alpine,
//       verif = null,
//       scope = "per-trail",
//       resources = Resource.make(),
//       concurrency = 1,
//     }: SidecarOptions<Result, VE, VR, Tools> = {},
//   ) {
//     const gradeContext = yield* Effect.context<R>();
//     const verifContext = yield* Effect.context<VR>();
//     const options = {
//       grade: (context: Sidecar.Context<Tools>) =>
//         grade(context).pipe(Effect.provide(gradeContext), Effect.mapError(Retry.mapError)),
//       snapshot,
//       verif:
//         verif === null
//           ? null
//           : {
//               exec: (context: Verif.Context<Tools>) =>
//                 verif.exec(context).pipe(
//                   Effect.provide(verifContext),
//                   Effect.mapError((cause) =>
//                     cause instanceof GradeError ? cause : GradeError.verify(cause),
//                   ),
//                 ),
//               expect: verif.expect,
//             },
//       scope,
//       resources,
//       concurrency,
//     };
//     return Object.assign(
//       Match.value(scope).pipe(
//         Match.when("per-task", () => Variant<Result, Tools>().TaskSidecar(options)),
//         Match.when("per-trail", () => Variant<Result, Tools>().TrailSidecar(options)),
//         Match.exhaustive,
//       ),
//       { schema },
//     ) satisfies Grader<Result, Tools>;
//   });

// type RunOptions = Readonly<{
//   sandbox: Sandbox.Sandbox;
//   trajectory: Trajectory.Trajectory<any>;
// }>;

// export type RunGrader = <R extends Schema.Constraint = any>(
//   options: RunOptions,
// ) => Effect.Effect<
//   R["Type"],
//   GradeError | Retry.Retry,
//   FileSystem.FileSystem | Path.Path | R["DecodingServices"]
// >;

// export class Service extends Context.Service<Service, RunGrader>()("GradeService") {}

// export const make = Effect.fn(function* <
//   Result extends Schema.Constraint,
//   Tools extends Record<string, Tool.Any>,
// >(grader: Grader<Result, Tools>) {
//   const scope = yield* Scope.Scope;
//   const sbxProvider = yield* Sandbox.ProviderService;

//   switch (grader._tag) {
//     case "Embed":
//       return Effect.fn(function* ({ sandbox, trajectory }: RunOptions) {
//         return yield* Embed.run(grader)({ sandbox, trajectory });
//       });
//     case "TrailSidecar":
//       const { snapshot: template, resources } = grader;

//       const snapshot = yield* sbxProvider
//         .acquireSnapshot({ template, cache: true })
//         .pipe(Effect.mapError(GradeError.sandbox))
//         .pipe(Effect.provideService(Scope.Scope, scope));

//       return Effect.fn(function* ({ sandbox: agentSbx, trajectory }: RunOptions) {
//         const gradeSbx = yield* sbxProvider
//           .runSandbox({ snapshot, resources, cache: false })
//           .pipe(Effect.mapError(GradeError.sandbox));

//         return yield* Sidecar.run(grader)({
//           agent: agentSbx,
//           grade: gradeSbx,
//           trajectory,
//         });
//       }, Effect.scoped);
//     case "TaskSidecar":
//       const { snapshot: template2, resources: resources2 } = grader;

//       const snapshot2 = yield* sbxProvider
//         .acquireSnapshot({ template: template2, cache: true })
//         .pipe(Effect.mapError(GradeError.sandbox))
//         .pipe(Effect.provideService(Scope.Scope, scope));

//       // grade sandbox are bound to the scope of creation
//       // can be used between multiple runs
//       const gradeSbx = yield* sbxProvider
//         .runSandbox({ snapshot: snapshot2, resources: resources2, cache: true })
//         .pipe(Effect.mapError(GradeError.sandbox))
//         .pipe(Effect.provideService(Scope.Scope, scope));

//       return Effect.fn(function* ({ sandbox: agentSbx, trajectory }: RunOptions) {
//         return yield* Sidecar.run(grader)({
//           agent: agentSbx,
//           grade: gradeSbx,
//           trajectory,
//         });
//       });
//   }
// });

// export const layerFrom = <Result extends Schema.Constraint, Tools extends Record<string, Tool.Any>>(
//   grader: Grader<Result, Tools>,
// ) => Layer.effect(Service, make(grader));

// export * from "./error.ts";
// export * from "./retry.ts";
// export * as Base from "./embed.ts";
// export * as Sidecar from "./sidecar.ts";
// export * as Verif from "./verif.ts";
