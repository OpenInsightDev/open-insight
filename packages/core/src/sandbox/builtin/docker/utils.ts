import { ChildProcess as CP } from "effect/unstable/process";
import { isUnlimited, type Resources } from "#/sandbox/resource.ts";

export const dockerOptions = { detached: false } satisfies CP.CommandOptions;

type PortMapping = Readonly<{
  sandboxPort: number;
  hostPort?: number;
}>;

export const formatResources = (resources: Resources | null): Array<string> => {
  if (!resources) {
    return [];
  }

  const { numCPUs, memoryMiB, numGPUs, storageMiB, network } = resources;
  const resourceArgs: Array<string> = [];
  if (!isUnlimited(numCPUs)) {
    resourceArgs.push("--cpus", `${numCPUs}`);
  }

  if (!isUnlimited(memoryMiB)) {
    resourceArgs.push("--memory", `${memoryMiB}m`);
  }

  if (!isUnlimited(numGPUs) && numGPUs > 0) {
    resourceArgs.push("--gpus", `count=${numGPUs}`);
  }

  if (!isUnlimited(storageMiB)) {
    resourceArgs.push("--storage-opt", `size=${storageMiB}m`);
  }

  if (!network) {
    resourceArgs.push("--network", "none");
  }

  return resourceArgs;
};

export const formatPortMappings = (portMappings: ReadonlyArray<PortMapping>): Array<string> =>
  portMappings.flatMap(({ sandboxPort, hostPort }) => [
    "-p",
    hostPort === undefined ? `${sandboxPort}` : `${hostPort}:${sandboxPort}`,
  ]);

export const matchesPortMapping = (
  portMappings: ReadonlyArray<PortMapping>,
  { sandboxPort, hostPort }: PortMapping,
) =>
  portMappings.some(
    (mapping) =>
      mapping.sandboxPort === sandboxPort &&
      (hostPort === undefined || mapping.hostPort === hostPort),
  );
