import { Effect, Schema } from "effect";

const defaultHelpArgs = ["--help"] as const;

export class CliOptions extends Schema.Class<CliOptions>("CliOptions")({
  command: Schema.NonEmptyString,
  helpArgs: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)).pipe(
    Schema.withConstructorDefault(Effect.succeed([...defaultHelpArgs])),
  ),
  runArgs: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)).pipe(
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
}) {}

export type Cli = string | CliOptions;

/** Normalizes a CLI spec into concrete options with defaults applied. */
export const from = (cli: Cli): CliOptions =>
  typeof cli === "string" ? CliOptions.make({ command: cli }) : CliOptions.make(cli);
