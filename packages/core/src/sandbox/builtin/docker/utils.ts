import * as Resource from "#/resource/index.ts";

export const formatResources = (resources: Resource.Resources | null): Array<string> => {
  if (!resources) {
    return [];
  }

  const { numCPUs, memoryMiB, numGPUs, storageMiB, network } = resources;
  const resourceArgs: Array<string> = [];
  if (!Resource.Limit.isUnlimited(numCPUs)) {
    resourceArgs.push("--cpus", `${numCPUs}`);
  }

  if (!Resource.Limit.isUnlimited(memoryMiB)) {
    resourceArgs.push("--memory", `${memoryMiB}m`);
  }

  if (!Resource.Limit.isUnlimited(numGPUs) && numGPUs > 0) {
    resourceArgs.push("--gpus", `count=${numGPUs}`);
  }

  if (!Resource.Limit.isUnlimited(storageMiB)) {
    resourceArgs.push("--storage-opt", `size=${storageMiB}m`);
  }

  if (Resource.Network.isNoNetwork(network)) {
    resourceArgs.push("--network", "none");
  }

  return resourceArgs;
};

export const formatPorts = (ports: ReadonlyArray<number>): Array<string> =>
  ports.flatMap((port) => ["-p", `${port}`]);

export const hasPort = (ports: ReadonlyArray<number>, port: number) => ports.includes(port);
