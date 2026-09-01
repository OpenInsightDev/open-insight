import { Data, Effect, Option, RcMap, Ref, Schema, Scope, Stream } from "effect";
import * as Agent from "#/agent/index.ts";
import * as Resource from "#/resource/index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import { HarnessError } from "./error.ts";
import * as Prompt from "#/prompt/index.ts";
import { Response, Tool, Toolkit } from "effect/unstable/ai";

export type AgentSession<Tools extends Record<string, Tool.Any> = Record<string, never>> =
  Readonly<{
    trajectory: Ref.Ref<Prompt.Prompt>;
    prompt(prompt: Prompt.Prompt): Stream.Stream<Response.StreamPartView<Tools>, HarnessError>;
  }>;

const makeAgentSession = <Tools extends Record<string, Tool.Any>>(agent: Agent.Agent) => {
  return {
    trajectory: agent.trajectory,
    prompt: (prompt) => agent.prompt(prompt).pipe(Stream.mapError(HarnessError.agent)),
  } satisfies AgentSession<Tools>;
};

export type SandboxSession<Tools extends Record<string, Tool.Any> = Record<string, never>> =
  Readonly<{
    sandbox: Sandbox.Sandbox;
    runAgent(): Effect.Effect<AgentSession<Tools>, HarnessError, Scope.Scope>;
  }>;

export type SandboxSessionConfig = Readonly<{
  resources: Resource.Resources;
  cache: boolean;
}>;
export const DefaultSandboxSessionConfig: SandboxSessionConfig = {
  resources: Resource.make(),
  cache: true,
};

export type SnapshotSession<Tools extends Record<string, Tool.Any> = Record<string, never>> =
  Readonly<{
    snapshot: Snapshot.Snapshot;

    runSandbox(
      options?: Partial<SandboxSessionConfig>,
    ): Effect.Effect<SandboxSession<Tools>, HarnessError, Scope.Scope>;
  }>;

export class Metadata extends Schema.Class<Metadata>("HarnessMetadata")({
  id: Schema.String,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export class Harness<ID extends string, Tools extends Record<string, Tool.Any>> extends Data.Class<{
  id: ID;
  metadata: Metadata;

  toolkit: Toolkit.Toolkit<Tools>;
  runSnapshot(
    snapshot: Snapshot.Template,
  ): Effect.Effect<SnapshotSession<Tools>, HarnessError, Scope.Scope>;
}> {}
export type Any = Harness<any, any>;
export type IDOf<H> = H extends Harness<infer ID, any> ? ID : never;
export type ToolkitOf<H> = H extends Harness<any, infer Tools> ? Toolkit.Toolkit<Tools> : never;

type Options = Omit<MetadataEncoded, "id"> & Readonly<{}>;

export const make = Effect.fn(function* <ID extends string, Tools extends Record<string, Tool.Any>>(
  id: ID,
  toolkit: Toolkit.Toolkit<Tools>,
  options: Options,
): Effect.fn.Return<
  Harness<ID, Tools>,
  HarnessError,
  Scope.Scope | Agent.ProviderService | Sandbox.ProviderService
> {
  const metadata = yield* Schema.decodeEffect(Metadata)({ id, ...options }).pipe(
    Effect.mapError(HarnessError.init),
  );

  const agentProvider = yield* Agent.ProviderService;
  const sandboxProvider = yield* Sandbox.ProviderService;

  const acquireSnapshot = (template: Snapshot.Template) =>
    sandboxProvider
      .acquireSnapshot({ template, cache: true })
      .pipe(Effect.mapError(HarnessError.snapshotAcquire(template)));

  const extendSnapshot = (template: Snapshot.Template) => (snapshot: Snapshot.Snapshot) =>
    agentProvider.snapshotExtension.pipe(
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

  const makeSandboxSession = Effect.fn("HarnessService.makeSandboxSession")(function* ({
    snapshot,
    options,
  }: Readonly<{
    snapshot: Snapshot.Snapshot;
    options: Partial<SandboxSessionConfig> | undefined;
  }>) {
    const { resources = Resource.make(), cache = true } = options ?? {};
    const sandbox = yield* sandboxProvider
      .runSandbox({ snapshot, resources, cache })
      .pipe(Effect.mapError(HarnessError.sandbox));

    const runAgent = Effect.fn("HarnessService.runAgent")(function* () {
      const agentSession = yield* agentProvider
        .runSession(sandbox)
        .pipe(Effect.mapError(HarnessError.agent));
      return makeAgentSession(agentSession);
    }) satisfies SandboxSession<Tools>["runAgent"];

    return { sandbox, runAgent } satisfies SandboxSession<Tools>;
  });

  const makeSnapshotSession = (snapshot: Snapshot.Snapshot): SnapshotSession<Tools> => {
    const runSandbox = Effect.fn("HarnessService.runSandbox")(function* (
      options?: Partial<SandboxSessionConfig>,
    ) {
      return yield* makeSandboxSession({ snapshot, options });
    }) satisfies SnapshotSession<Tools>["runSandbox"];

    return { snapshot, runSandbox } satisfies SnapshotSession<Tools>;
  };

  // Reference-counted snapshot session cache keyed by template equality
  const cache = yield* RcMap.make({
    lookup: (template: Snapshot.Template) =>
      Effect.succeed(template).pipe(
        Effect.flatMap(acquireSnapshot),
        Effect.flatMap(extendSnapshot(template)),
        Effect.map(makeSnapshotSession),
      ),
  });

  const runSnapshot = Effect.fn("HarnessService.runSnapshot")(function* (template) {
    return yield* RcMap.get(cache, template);
  }) satisfies Harness<ID, Tools>["runSnapshot"];

  return new Harness({ id, metadata, toolkit, runSnapshot });
});
