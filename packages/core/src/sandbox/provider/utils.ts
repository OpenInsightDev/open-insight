import { ChildProcess as CP } from "effect/unstable/process";

export const bashQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export const formatBash = (command: CP.StandardCommand) =>
  [command.command, ...command.args].map(bashQuote).join(" ");
