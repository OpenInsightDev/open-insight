import { Context, Effect, Layer, Option, Ref, Schema, Scope, Stream } from "effect";
import * as Agent from "#/agent/index.ts";
import * as Resource from "#/resource/index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import { HarnessError } from "./error.ts";
import * as Prompt from "#/prompt/index.ts";
import { Response } from "effect/unstable/ai";

export class Metadata extends Schema.Class<Metadata>("HarnessMetadata")({
  id: Schema.String,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export type AgentSession = Readonly<{
  trajectory: Ref.Ref<Prompt.Trajectory>;
  prompt(prompt: Prompt.Prompt): Stream.Stream<Response.StreamPartEncoded, HarnessError>;
}>;

const makeAgentSession = Effect.fn(function* (
  agent: Agent.Agent,
): Effect.fn.Return<AgentSession, HarnessError> {
  return {
    trajectory: agent.trajectory,
    prompt: (prompt) =>
      agent.prompt(prompt).pipe(
        Stream.mapEffect(Prompt.encodeResponseStreamPartEncoded),
        Stream.mapError((error) =>
          error instanceof Agent.AgentError
            ? HarnessError.agent(error)
            : HarnessError.agent(Agent.AgentError.stream(error)),
        ),
      ),
  } satisfies AgentSession;
});

export type SandboxSession = Readonly<{
  sandbox: Sandbox.Sandbox;
  runAgent(): Effect.Effect<AgentSession, HarnessError, Scope.Scope>;
}>;

export type SandboxSessionConfig = Readonly<{
  /** The resources to provide to the sandbox. */
  resources: Resource.Resources;

  /** Whether the sandbox may be reused from the snapshot cache. Defaults to `true`. */
  cache: boolean;
}>;
export const DefaultSandboxSessionConfig: SandboxSessionConfig = {
  resources: Resource.make(),
  cache: true,
};

export type SnapshotSession = Readonly<{
  /** The snapshot built from the task template, used to run a sandbox. */
  snapshot: Snapshot.Snapshot;

  /** Run a sandbox backed by `snapshot`. */
  runSandbox(
    options?: Partial<SandboxSessionConfig>,
  ): Effect.Effect<SandboxSession, HarnessError, Scope.Scope>;
}>;

export type SnapshotSessionConfig = Readonly<{
  /** Whether task sandbox snapshots may be reused from the snapshot cache. Defaults to `true`. */
  cacheTaskSnapshot: boolean;

  /** Whether agent-derived snapshots may be reused from the snapshot cache. Defaults to `true`. */
  cacheAgentSnapshot: boolean;
}>;
export const DefaultSnapshotSessionConfig: SnapshotSessionConfig = {
  cacheTaskSnapshot: true,
  cacheAgentSnapshot: true,
};

export type Harness = Readonly<{
  metadata: Metadata;
  runSnapshot(
    snapshot: Snapshot.Template,
    options?: Partial<SnapshotSessionConfig>,
  ): Effect.Effect<SnapshotSession, HarnessError, Scope.Scope>;
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
          template,
          { cacheTaskSnapshot = true, cacheAgentSnapshot = true } = {},
        ) {
          const snapshot = yield* sandboxProvider
            .acquireSnapshot({ template, cache: cacheTaskSnapshot })
            .pipe(Effect.mapError(HarnessError.snapshotAcquire(template)));

          const extended = yield* agentProvider.snapshotExtension.pipe(
            Option.match({
              onNone: () => Effect.succeed(snapshot),
              onSome: ({ instructions, context }) =>
                sandboxProvider
                  .deriveSnapshot({
                    snapshot,
                    instructions,
                    context: context ?? template.context,
                    cache: cacheAgentSnapshot,
                  })
                  .pipe(Effect.mapError(HarnessError.snapshotDerive(instructions))),
            }),
          );

          const runSandbox = Effect.fn("HarnessService.runSandbox")(function* ({
            resources = Resource.make(),
            cache = true,
          } = {}) {
            const sandbox = yield* sandboxProvider
              .runSandbox({ snapshot: extended, resources, cache })
              .pipe(Effect.mapError(HarnessError.sandbox));

            const runAgent = Effect.fn("HarnessService.runAgent")(function* () {
              const agentSession = yield* agentProvider
                .runSession(sandbox)
                .pipe(Effect.mapError(HarnessError.agent));
              return yield* makeAgentSession(agentSession);
            }) satisfies SandboxSession["runAgent"];

            return { sandbox, runAgent: runAgent } satisfies SandboxSession;
          }) satisfies SnapshotSession["runSandbox"];

          return { snapshot: extended, runSandbox } satisfies SnapshotSession;
        }) satisfies Harness["runSnapshot"];

        return { metadata, runSnapshot: build } satisfies Harness;
      }),
    );
  };
}
