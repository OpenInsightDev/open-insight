import { Agent, Snapshot } from "@open-insight/core";
import { Effect, Path } from "effect";
import { fromDir } from "./from-dir.ts";

export type Config = Readonly<{
  directory: string;
  sandboxDirectory: string;
}>;

export type Prepared = Readonly<{
  snapshotExtension: Agent.SnapshotExtension;
  systemInstructions: string;
}>;

export const directory = (
  source: string,
  options?: { readonly sandboxDirectory?: string },
): Config => ({
  directory: source,
  sandboxDirectory: options?.sandboxDirectory ?? "/opt/open-insight/skills",
});

export const prepare = Effect.fn(function* (config: Config) {
  const path = yield* Path.Path;
  const resolvedDirectory = path.resolve(config.directory);
  const metadata = yield* fromDir(resolvedDirectory);
  const sourceName = path.basename(resolvedDirectory);
  const context = path.dirname(resolvedDirectory);
  const skillLines = metadata.map(
    ({ name, description }) =>
      `- ${name}: ${description} Read ${path.join(config.sandboxDirectory, name, "SKILL.md")} when this skill is relevant.`,
  );

  return {
    snapshotExtension: {
      context,
      instructions: [Snapshot.copy([sourceName], config.sandboxDirectory)],
    },
    systemInstructions: [
      "Available skills:",
      ...skillLines,
      "Read a skill's SKILL.md before following it. Only load skills relevant to the current task.",
    ].join("\n"),
  } satisfies Prepared;
});
