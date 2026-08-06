import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect";
import * as Agent from "#/agent/index.ts";
import * as Resource from "#/resource/index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import { HarnessError } from "./error.ts";
import type * as Prompt from "#/prompt/index.ts";
import type { StreamPartEncoded } from "effect/unstable/ai/Response";

export class Metadata extends Schema.Class<Metadata>("HarnessMetadata")({
  id: Schema.String,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export type Session = Readonly<{
  trajectory: Effect.Effect<Prompt.Trajectory, HarnessError>;
  prompt(prompt: Prompt.Prompt): Stream.Stream<StreamPartEncoded, HarnessError>;
}>;

export type SessionConfig = Readonly<{
  // TODO support per-session network policies
}>;

const makeSession = Effect.fn(function* (
  agent: Agent.Agent,
): Effect.fn.Return<Session, HarnessError> {
  return {
    trajectory: agent.trajectory.pipe(Effect.mapError(HarnessError.agent)),
    prompt: (prompt) => agent.prompt(prompt).pipe(Stream.mapError(HarnessError.agent)),
  } satisfies Session;
});

export type SandboxRun = Readonly<{
  sandbox: Sandbox.Sandbox;
  runSession(options?: Partial<SessionConfig>): Effect.Effect<Session, HarnessError, Scope.Scope>;
}>;

export type SandboxConfig = Readonly<{
  /** The resources to provide to the sandbox. */
  resources: Resource.Resources;
}>;

export type SnapshotRun = Readonly<{
  /** The snapshot handle built from the task snapshot, used to run a sandbox. */
  handle: Snapshot.Handle.Handle;

  /** Run a sandbox backed by `snapshotHandle`. */
  runSandbox(
    options?: Partial<SandboxConfig>,
  ): Effect.Effect<SandboxRun, HarnessError, Scope.Scope>;
}>;

export type BuildConfig = Readonly<{
  /** Whether task sandbox snapshots may be reused from the snapshot cache. Defaults to `true`. */
  cacheTaskSnapshot: boolean;

  /** Whether agent-derived snapshots may be reused from the snapshot cache. Defaults to `true`. */
  cacheAgentSnapshot: boolean;
}>;

export type Harness = Readonly<{
  metadata: Metadata;
  buildSnapshot(
    snapshot: Snapshot.Snapshot,
    options?: Partial<BuildConfig>,
  ): Effect.Effect<SnapshotRun, HarnessError, Scope.Scope>;
}>;

export type ConfigOptions = Omit<MetadataEncoded, "id">;

export class Service extends Context.Service<Service, Harness>()("harness/Service") {
  static layer = (
    id: string,
    config: ConfigOptions = {},
  ): Layer.Layer<Service, HarnessError, Agent.ProviderService | Sandbox.ProviderService> => {
    return Layer.effect(
      this,
      Effect.gen(function* () {
        const agentProvider = yield* Agent.ProviderService;
        const sandboxProvider = yield* Sandbox.ProviderService;

        const metadata = yield* Schema.decodeEffect(Metadata)({ id, ...config }).pipe(
          Effect.mapError(HarnessError.init),
        );

        const build = Effect.fn("HarnessService.build")(function* (
          snapshot,
          { cacheTaskSnapshot = true, cacheAgentSnapshot = true } = {},
        ) {
          const taskSnapshot = yield* sandboxProvider
            .aquireSnapshot({ snapshot, cache: cacheTaskSnapshot })
            .pipe(Effect.mapError(HarnessError.snapshotAcquire(snapshot)));

          const handle = yield* agentProvider.snapshotExtension.pipe(
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
                  .pipe(Effect.mapError(HarnessError.snapshotDerive(instructions))),
            }),
          );

          const runSandbox = Effect.fn("HarnessService.runSandbox")(function* ({
            resources = Resource.make(),
          } = {}) {
            const sandbox = yield* sandboxProvider
              .runSandbox({ handle, resources })
              .pipe(Effect.mapError(HarnessError.sandbox));

            const runSession = Effect.fn("HarnessService.runSession")(function* (_config = {}) {
              const agentSession = yield* agentProvider
                .runSession(sandbox)
                .pipe(Effect.mapError(HarnessError.agent));
              return yield* makeSession(agentSession);
            }) satisfies SandboxRun["runSession"];

            return { sandbox, runSession } satisfies SandboxRun;
          }) satisfies SnapshotRun["runSandbox"];

          return { handle, runSandbox } satisfies SnapshotRun;
        }) satisfies Harness["buildSnapshot"];

        return { metadata, buildSnapshot: build } satisfies Harness;
      }),
    );
  };
}
