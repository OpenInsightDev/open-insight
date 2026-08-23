import { Context, Effect, Layer, Option, RcMap, Ref, Schema, Scope, Stream } from "effect";
import * as Agent from "#/agent/index.ts";
import * as Resource from "#/resource/index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import { HarnessError } from "./error.ts";
import * as Prompt from "#/prompt/index.ts";
import { Response } from "@open-insight/core/internal";
import { Tool, Toolkit } from "effect/unstable/ai";

export class Metadata extends Schema.Class<Metadata>("HarnessMetadata")({
  id: Schema.String,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export type AgentSession<Tools extends Record<string, Tool.Any> = {}> = Readonly<{
  toolkit?: Toolkit.Toolkit<Tools>;
  trajectory: Ref.Ref<Prompt.Trajectory>;
  prompt(
    prompt: Prompt.Prompt,
  ): Stream.Stream<
    Response.AnyStreamPart,
    HarnessError,
    Schema.Codec.DecodingServices<ReturnType<typeof Response.StreamPart<Toolkit.Toolkit<Tools>>>>
  >;
}>;

export const AgentService = Context.Service<AgentSession>("AgentService");

const makeAgentSession = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
  agent: Agent.Agent<Tools>,
): Effect.fn.Return<AgentSession<Tools>, HarnessError> {
  return {
    toolkit: agent.toolkit,
    trajectory: agent.trajectory,
    prompt: (prompt) => agent.prompt(prompt).pipe(Stream.mapError(HarnessError.agent)),
  } satisfies AgentSession<Tools>;
});

export type SandboxSession = Readonly<{
  sandbox: Sandbox.Sandbox;
  runAgent(): Effect.Effect<AgentSession, HarnessError, Scope.Scope>;
}>;

export const SandboxService = Context.Service<SandboxSession>("SandboxService");

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

export const SnapService = Context.Service<SnapshotSession>("SnapService");

export type Harness = Readonly<{
  metadata: Metadata;
  runSnapshot(
    snapshot: Snapshot.Template,
  ): Effect.Effect<SnapshotSession, HarnessError, Scope.Scope>;
}>;

export type ConfigOptions = Omit<MetadataEncoded, "id"> &
  Readonly<{
    toolkit?: Toolkit.Toolkit<Record<string, Tool.Any>>;
  }>;

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
        const { toolkit } = config;

        const metadata = yield* Schema.decodeEffect(Metadata)({ id, ...config }).pipe(
          Effect.mapError(HarnessError.init),
        );

        // Reference-counted snapshot session cache keyed by template equality
        const cache = yield* RcMap.make({
          lookup: (template: Snapshot.Template) =>
            Effect.gen(function* () {
              const snapshot = yield* sandboxProvider
                .acquireSnapshot({ template, cache: true })
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
                        cache: true,
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
                    .runSession(sandbox, toolkit)
                    .pipe(Effect.mapError(HarnessError.agent));
                  return yield* makeAgentSession(agentSession);
                }) satisfies SandboxSession["runAgent"];

                return { sandbox, runAgent: runAgent } satisfies SandboxSession;
              }) satisfies SnapshotSession["runSandbox"];

              return { snapshot: extended, runSandbox } satisfies SnapshotSession;
            }),
        });

        const runSnapshot = Effect.fn("HarnessService.runSnapshot")(function* (template) {
          return yield* RcMap.get(cache, template);
        }) satisfies Harness["runSnapshot"];

        return { metadata, runSnapshot } satisfies Harness;
      }),
    );
  };
}
