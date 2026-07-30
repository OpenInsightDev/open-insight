import * as Resource from "#/resource/index.ts";
import { Effect, Schema } from "effect";
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

export const formatResources = (resources: Resource.Resources | null): Array<string> => {
  if (!resources) {
    return [];
  }

  const { numCPUs, memoryMiB } = resources;
  const resourceArgs: Array<string> = [];
  if (!Resource.Limit.isUnlimited(numCPUs)) {
    resourceArgs.push("--cpus", `${numCPUs}`);
  }

  if (!Resource.Limit.isUnlimited(memoryMiB)) {
    resourceArgs.push("--memory", `${memoryMiB}M`);
  }

  return resourceArgs;
};
