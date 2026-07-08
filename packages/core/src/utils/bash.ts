import { Match } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";

export const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export const format = (command: CP.Command): string =>
  Match.value(command).pipe(
    Match.tag("StandardCommand", ({ command, args }) => [command, ...args].map(quote).join(" ")),
    Match.tag("PipedCommand", ({ left, right }) => `${format(left)} | ${format(right)}`),
    Match.exhaustive,
  );
