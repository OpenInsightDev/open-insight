import { Agent, Snapshot } from "@open-insight/core";
import { Context, Effect, Layer, Option, Path, Schema } from "effect";
import { fromDir } from "./from-dir.ts";

const defaultDir = "/opt/open-insight/skills";

export class Config extends Schema.Class<Config>("SkillsConfig")({
  directory: Schema.NonEmptyString,
  sandboxDirectory: Schema.NonEmptyString.pipe(
    Schema.withConstructorDefault(Effect.succeed(defaultDir)),
  ),
}) {}

type Skills = Readonly<{
  snapshotExtension: Option.Option<Agent.SnapshotExtension>;
  systemInstructions: Option.Option<string>;
}>;

export const Service = Context.Reference<Skills>("agent/Skills", {
  defaultValue: () => ({
    snapshotExtension: Option.none(),
    systemInstructions: Option.none(),
  }),
});

export const directory = (
  source: string,
  options?: { readonly sandboxDirectory?: string },
): Config =>
  Config.make({
    directory: source,
    sandboxDirectory: options?.sandboxDirectory,
  });

const load = Effect.fn(function* (config: Config) {
  const path = yield* Path.Path;
  const dir = path.resolve(config.directory);
  const metadata = yield* fromDir(dir);
  const source = path.basename(dir);
  const context = path.dirname(dir);
  const skillLines = metadata.map(
    ({ name, description }) =>
      `- ${name}: ${description} Read ${path.join(config.sandboxDirectory, name, "SKILL.md")} when this skill is relevant.`,
  );

  return {
    snapshotExtension: Option.some({
      context,
      instructions: [Snapshot.copy([source], config.sandboxDirectory)],
    }),
    systemInstructions: Option.some(
      [
        "Available skills:",
        ...skillLines,
        "Read a skill's SKILL.md before following it. Only load skills relevant to the current task.",
      ].join("\n"),
    ),
  };
});

export const layer = (config: Config) => Layer.effect(Service)(load(config));
