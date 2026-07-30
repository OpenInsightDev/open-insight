import * as Resource from "#/resource/index.ts";
import { ChildProcess as CP } from "effect/unstable/process";

export const containerOptions = { detached: false } satisfies CP.CommandOptions;
export const minimumMemoryMiB = 200;

export type PortMapping = Readonly<{
  sandboxPort: number;
  hostPort: number;
}>;

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

export const formatPortMappings = (portMappings: ReadonlyArray<PortMapping>): Array<string> =>
  portMappings.flatMap(({ sandboxPort, hostPort }) => ["--publish", `${hostPort}:${sandboxPort}`]);

export const findPortMapping = (portMappings: ReadonlyArray<PortMapping>, sandboxPort: number) =>
  portMappings.find((mapping) => mapping.sandboxPort === sandboxPort);
