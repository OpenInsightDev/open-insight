import { Match } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";

export const bashQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export const formatBash = (command: CP.Command): string =>
  Match.value(command).pipe(
    Match.tag("StandardCommand", ({ command, args }) =>
      [command, ...args].map(bashQuote).join(" "),
    ),
    Match.tag("PipedCommand", ({ left, right }) => `${formatBash(left)} | ${formatBash(right)}`),
    Match.exhaustive,
  );
