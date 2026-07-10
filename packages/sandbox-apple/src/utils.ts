import { Sandbox } from "@open-insight/core";
import { ChildProcess as CP } from "effect/unstable/process";

export const containerOptions = { detached: false } satisfies CP.CommandOptions;
export const minimumMemoryMiB = 200;

type PortMapping = Readonly<{
  sandboxPort: number;
  hostPort: number;
}>;

export const formatResources = (resources: Sandbox.Resources | null): Array<string> => {
  if (!resources) {
    return [];
  }

  const { numCPUs, memoryMiB } = resources;
  const resourceArgs: Array<string> = [];
  if (!Sandbox.isUnlimited(numCPUs)) {
    resourceArgs.push("--cpus", `${numCPUs}`);
  }

  if (!Sandbox.isUnlimited(memoryMiB)) {
    resourceArgs.push("--memory", `${memoryMiB}M`);
  }

  return resourceArgs;
};

export const formatPortMappings = (portMappings: ReadonlyArray<PortMapping>): Array<string> =>
  portMappings.flatMap(({ sandboxPort, hostPort }) => ["--publish", `${hostPort}:${sandboxPort}`]);

export const matchesPortMapping = (
  portMappings: ReadonlyArray<PortMapping>,
  { sandboxPort, hostPort }: Readonly<{ sandboxPort: number; hostPort?: number }>,
) =>
  portMappings.some(
    (mapping) =>
      mapping.sandboxPort === sandboxPort &&
      (hostPort === undefined || mapping.hostPort === hostPort),
  );
