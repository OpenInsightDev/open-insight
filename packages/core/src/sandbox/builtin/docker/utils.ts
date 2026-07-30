import * as Resource from "#/resource/index.ts";
import { Option } from "effect";

export const formatResources = (resources: Resource.Resources | null): Array<string> => {
  if (!resources) {
    return [];
  }

  const { numCPUs, memoryMiB, numGPUs, storageMiB, network } = resources;
  const resourceArgs: Array<string> = [];
  if (Option.isSome(numCPUs)) {
    resourceArgs.push("--cpus", `${numCPUs.value}`);
  }

  if (Option.isSome(memoryMiB)) {
    resourceArgs.push("--memory", `${memoryMiB.value}m`);
  }

  if (Option.isSome(numGPUs) && numGPUs.value > 0) {
    resourceArgs.push("--gpus", `count=${numGPUs.value}`);
  }

  if (Option.isSome(storageMiB)) {
    resourceArgs.push("--storage-opt", `size=${storageMiB.value}m`);
  }

  if (Option.isSome(network) && Resource.isNoNetwork(network.value)) {
    resourceArgs.push("--network", "none");
  }

  return resourceArgs;
};

export const formatPorts = (ports: ReadonlyArray<number>): Array<string> =>
  ports.flatMap((port) => ["-p", `${port}`]);

export const hasPort = (ports: ReadonlyArray<number>, port: number) => ports.includes(port);
