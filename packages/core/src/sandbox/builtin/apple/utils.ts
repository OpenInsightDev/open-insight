import * as Resource from "#/resource/index.ts";
import * as Sandbox from "#/sandbox/export.ts";
import { Effect, Option, Schema } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import ipaddr from "ipaddr.js";

export const containerOptions = { detached: false } satisfies CP.CommandOptions;
export const minimumMemoryMiB = 200;

const ContainerAddress = Schema.String.check(
  Schema.makeFilter(ipaddr.isValidCIDR, {
    expected: "an IP address with a CIDR prefix",
  }),
);

const ContainerInspectOutput = Schema.fromJsonString(
  Schema.NonEmptyArray(
    Schema.Struct({
      networks: Schema.NonEmptyArray(
        Schema.Struct({
          address: ContainerAddress,
        }),
      ),
    }),
  ),
);

const decodeContainerInspectOutput = Schema.decodeUnknownEffect(ContainerInspectOutput);

export const parseContainerHost = Effect.fn(function* (output: string) {
  const containers = yield* decodeContainerInspectOutput(output);
  const [address] = ipaddr.parseCIDR(containers[0].networks[0].address);
  const host = address.toString();
  return address.kind() === "ipv6" ? `[${host}]` : host;
});

export const formatResources = Effect.fn(function* (
  name: string,
  resources: Resource.Resources | null,
) {
  if (!resources) {
    return [];
  }

  const { numGPUs, storageMiB, numCPUs, memoryMiB } = resources;

  if (Option.isSome(numGPUs)) {
    return yield* Effect.fail(
      Sandbox.Error.sandboxStart(name)(
        new Error(
          `Apple container does not support GPU allocation, ` + `received: ${numGPUs.value}`,
        ),
      ),
    );
  }

  if (Option.isSome(storageMiB)) {
    return yield* Effect.fail(
      Sandbox.Error.sandboxStart(name)(
        new Error(
          `Apple container does not support storage size limits on the root filesystem, ` +
            `received: ${storageMiB.value}`,
        ),
      ),
    );
  }

  const resourceArgs: Array<string> = [];
  if (Option.isSome(numCPUs)) {
    resourceArgs.push("--cpus", `${numCPUs.value}`);
  }

  if (Option.isSome(memoryMiB)) {
    resourceArgs.push("--memory", `${memoryMiB.value}M`);
  }

  return resourceArgs;
});
