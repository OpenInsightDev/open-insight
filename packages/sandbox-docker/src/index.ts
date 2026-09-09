import { DockerClient, type IPAMConfig, type NetworkCreateRequest } from "@docker/node-sdk";
import { Context, Effect, Formatter, Layer, Schema } from "effect";
import type * as Scope from "effect/Scope";

/**
 * Options for creating a macvlan Docker network.
 */
export type MakeNetworkOptions = Readonly<{
  /**
   * The IP segment (CIDR) that the macvlan network covers, e.g. `"192.168.1.0/24"`.
   */
  readonly subnet: string;
  /**
   * The host network interface the macvlan driver binds to, e.g. `"eth0"`.
   */
  readonly parent: string;
  /**
   * The gateway address of the subnet.
   *
   * Defaults to the first usable address of `subnet` when omitted.
   */
  readonly gateway?: string;
}>;

export class NetworkOperationFailed extends Schema.TaggedError<NetworkOperationFailed>(
  "open-insight/sandbox-docker/NetworkOperationFailed",
)("NetworkOperationFailed", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Docker network operation "${this.operation}" failed: ${Formatter.format(this.cause)}`;
  }
}

export class Docker extends Context.Service<Docker, DockerClient>()(
  "open-insight/sandbox-docker/Docker",
) {
  static readonly layer = Layer.effect(
    Docker,
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () => DockerClient.fromDockerConfig(),
        catch: (cause) => NetworkOperationFailed.make({ operation: "connect", cause }),
      }),
      (docker) => Effect.tryPromise(() => docker.close()).pipe(Effect.ignore),
    ).pipe(Effect.map((client) => Docker.of(client))),
  );
}

const removeNetwork = (docker: DockerClient, name: string) =>
  Effect.tryPromise(() => docker.networkDelete(name)).pipe(
    Effect.tapError((cause) =>
      Effect.logWarning("Failed to remove Docker macvlan network", { networkName: name, cause }),
    ),
    Effect.ignore,
  );

/**
 * Creates a macvlan Docker network covering the given IP segment and returns
 * its network name.
 *
 * The network and its Docker connection are kept alive for the duration of the
 * scope, and the network is removed when the scope closes.
 */
export const makeNetwork = Effect.fn("makeNetwork")(function* ({
  subnet,
  parent,
  gateway,
}: MakeNetworkOptions): Effect.fn.Return<string, NetworkOperationFailed, Scope.Scope | Docker> {
  yield* Effect.logDebug("Creating Docker macvlan network", { subnet, parent });

  const client = yield* Docker;

  const name = `open-insight-${crypto.randomUUID()}`;
  const ipamConfig: IPAMConfig = { Subnet: subnet };
  if (gateway !== undefined) {
    ipamConfig.Gateway = gateway;
  }
  const config = {
    Name: name,
    Driver: "macvlan",
    Options: { parent },
    IPAM: { Config: [ipamConfig] },
  } satisfies NetworkCreateRequest;

  yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => client.networkCreate(config),
      catch: (cause) => NetworkOperationFailed.make({ operation: "create", cause }),
    }).pipe(Effect.asVoid),
    () => removeNetwork(client, name),
  );

  yield* Effect.logInfo("Created Docker macvlan network", {
    networkName: name,
    subnet,
    parent,
  });

  return name;
});

export const makeProcess = Effect.fn(function* (containerID: string) {});

export const makeTerminal = Effect.fn(function* (containerID: string) {});

export const make = Effect.fn(function* () {});
