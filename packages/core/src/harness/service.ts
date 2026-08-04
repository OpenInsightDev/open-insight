import { Context, Effect, Layer, Option, Scope } from "effect";
import * as Agent from "#/agent/index.ts";
import * as Resource from "#/resource/index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import { Error } from "./error.ts";

export type Session = Agent.Agent;

export type Run = Readonly<{
  sandbox: Sandbox.Sandbox;
  runSession(): Effect.Effect<Session, Error>;
}>;

export type Harness = Readonly<{
  run(
    snapshot: Snapshot.Snapshot,
    options?: Readonly<{
      resources?: Resource.Resources;
    }>,
  ): Effect.Effect<Run, Error, Scope.Scope>;
}>;

export type Config = Readonly<{
  cacheTaskSnapshot?: boolean;
  cacheAgentSnapshot?: boolean;
}>;

export class Service extends Context.Service<Service, Harness>()("harness/Service") {
  static layerFrom = (config: Config = {}) =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const agentProvider = yield* Agent.ProviderService;
        const sandboxProvider = yield* Sandbox.ProviderService;

        const run = Effect.fn("HarnessService.run")(function* (
          snapshot,
          { resources = Resource.make() } = {},
        ) {
          const taskSnapshot = yield* sandboxProvider
            .aquireSnapshot({ snapshot, cache: config.cacheTaskSnapshot })
            .pipe(Effect.mapError(Error.snapshotAcquire(snapshot)));

          const runSnapshot = yield* agentProvider.snapshotExtension.pipe(
            Option.match({
              onNone: () => Effect.succeed(taskSnapshot),
              onSome: ({ instructions, context }) =>
                sandboxProvider
                  .deriveSnapshot({
                    handle: taskSnapshot,
                    instructions,
                    context: context ?? snapshot.context,
                    cache: config.cacheAgentSnapshot,
                  })
                  .pipe(Effect.mapError(Error.snapshotDerive(instructions))),
            }),
          );

          const sandbox = yield* sandboxProvider
            .runSandbox({ handle: runSnapshot, resources })
            .pipe(Effect.mapError(Error.sandbox));

          return {
            sandbox,
            runSession: Effect.fn(function* () {
              return yield* agentProvider.runSession(sandbox).pipe(Effect.mapError(Error.agent));
            }),
          };
        }) satisfies Harness["run"];

        return { run };
      }),
    );
}
