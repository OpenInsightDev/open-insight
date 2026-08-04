import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect";
import * as Agent from "#/agent/index.ts";
import * as Resource from "#/resource/index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import { Error } from "./error.ts";
import type * as Prompt from "#/prompt/index.ts";
import type { StreamPartEncoded } from "effect/unstable/ai/Response";

export class Metadata extends Schema.Class<Metadata>("HarnessMetadata")({
  id: Schema.String,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
type MetadataEncoded = Schema.Codec.Encoded<Metadata>;

export type Session = Readonly<{
  trajectory: Effect.Effect<Prompt.Trajectory, Error>;
  prompt(prompt: Prompt.Prompt): Stream.Stream<StreamPartEncoded, Error>;
}>;

const makeSession = Effect.fn(function* (agent: Agent.Agent): Effect.fn.Return<Session, Error> {
  return {
    trajectory: agent.trajectory.pipe(Effect.mapError(Error.agent)),
    prompt: (prompt) => agent.prompt(prompt).pipe(Stream.mapError(Error.agent)),
  } satisfies Session;
});

export type Run = Readonly<{
  sandbox: Sandbox.Sandbox;
  runSession(): Effect.Effect<Session, Error>;
}>;

export type Config = Readonly<{
  /** Whether task sandbox snapshots may be reused from the snapshot cache. Defaults to `true`. */
  cacheTaskSnapshot: boolean;

  /** Whether agent-derived snapshots may be reused from the snapshot cache. Defaults to `true`. */
  cacheAgentSnapshot: boolean;
}>;

export type Harness = Readonly<{
  metadata: Metadata;
  run(
    snapshot: Snapshot.Snapshot,
    options?: Partial<Config> &
      Readonly<{
        resources?: Resource.Resources;
      }>,
  ): Effect.Effect<Run, Error, Scope.Scope>;
}>;

export class Service extends Context.Service<Service, Harness>()("harness/Service") {
  static layer = (id: string, config: Omit<MetadataEncoded, "id"> = {}) =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const agentProvider = yield* Agent.ProviderService;
        const sandboxProvider = yield* Sandbox.ProviderService;

        const metadata = yield* Schema.decodeEffect(Metadata)({ id, ...config });

        const run = Effect.fn("HarnessService.run")(function* (
          snapshot,
          { resources = Resource.make(), cacheTaskSnapshot = true, cacheAgentSnapshot = true } = {},
        ) {
          const taskSnapshot = yield* sandboxProvider
            .aquireSnapshot({ snapshot, cache: cacheTaskSnapshot })
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
                    cache: cacheAgentSnapshot,
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
              const agentSession = yield* agentProvider
                .runSession(sandbox)
                .pipe(Effect.mapError(Error.agent));
              return yield* makeSession(agentSession);
            }),
          };
        }) satisfies Harness["run"];

        return { metadata, run };
      }),
    );
}
