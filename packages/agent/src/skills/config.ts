import { Snapshot } from "@open-insight/core";
import { Effect, Path, Schema } from "effect";
import { fromDir } from "./from-dir.ts";

const defaultSandboxDirectory = "/opt/open-insight/skills";

export class Config extends Schema.Class<Config>("SkillsConfig")({
  directory: Schema.NonEmptyString,
  sandboxDirectory: Schema.NonEmptyString.pipe(
    Schema.withConstructorDefault(Effect.succeed(defaultSandboxDirectory)),
  ),
}) {}

export class Prepared extends Schema.Class<Prepared>("PreparedSkills")({
  snapshotExtension: Schema.Struct({
    instructions: Snapshot.Instructions,
    context: Schema.optionalKey(Schema.String),
  }),
  systemInstructions: Schema.String,
}) {}

export const directory = (
  source: string,
  options?: { readonly sandboxDirectory?: string },
): Config =>
  Config.make({
    directory: source,
    sandboxDirectory: options?.sandboxDirectory,
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

  return Prepared.make({
    snapshotExtension: {
      context,
      instructions: [Snapshot.copy([sourceName], config.sandboxDirectory)],
    },
    systemInstructions: [
      "Available skills:",
      ...skillLines,
      "Read a skill's SKILL.md before following it. Only load skills relevant to the current task.",
    ].join("\n"),
  });
});
