import { Sandbox } from "@open-insight/core";
import { Effect } from "effect";
import { from, type Cli, type CliOptions } from "./config.ts";
import { Error } from "./error.ts";

export * from "./config.ts";
export * from "./error.ts";

export type HelpPage = Readonly<{
  command: string;
  runArgs: ReadonlyArray<string>;
  help: string;
}>;

/** Runs a CLI's help command and captures its output (stdout and stderr). */
export const fetchHelp = Effect.fn(function* (cli: CliOptions, sandbox: Sandbox.Sandbox) {
  const { command, helpArgs, runArgs } = cli;
  const handle = yield* sandbox
    .spawn(
      { command, args: helpArgs === undefined ? undefined : Array.from(helpArgs) },
      { errorOnNonZeroExit: false },
    )
    .pipe(Effect.mapError(Error.help(command)));
  const help = [handle.stdout, handle.stderr]
    .filter((part) => part.length > 0)
    .join("\n")
    .trim();
  return { command, runArgs: runArgs ?? [], help } satisfies HelpPage;
});

const formatPage = (page: HelpPage): string => {
  const usage =
    page.runArgs.length === 0 ? page.command : `${page.command} ${page.runArgs.join(" ")}`;
  const sections = [`CLI: ${page.command}`, `Usage: ${usage} [arguments...]`];
  if (page.help.length > 0) {
    sections.push("", page.help);
  }
  return sections.join("\n");
};

/**
 * Fetches the help page of every CLI in parallel and joins them into a prompt
 * section describing how to invoke each tool at runtime.
 */
export const instructions = Effect.fn(function* (
  clis: ReadonlyArray<Cli>,
  sandbox: Sandbox.Sandbox,
) {
  if (clis.length === 0) {
    return undefined;
  }
  const pages = yield* Effect.forEach(clis, (cli) => fetchHelp(from(cli), sandbox), {
    concurrency: "unbounded",
  });
  return pages.map(formatPage).join("\n\n");
});
