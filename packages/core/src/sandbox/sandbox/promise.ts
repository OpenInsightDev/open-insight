import { Effect, FiberSet } from "effect";
import { Bash } from "#/utils/index.ts";
import type { Sandbox, Handle, Command } from "./index.ts";

type ShellTemplateValue = string | number | boolean;
type ShellTemplateExpression = ShellTemplateValue | ReadonlyArray<ShellTemplateValue>;

// shell template literal can provide command and args
type ShellOptions = Omit<Command, "command" | "args">;

const isTemplateStringsArray = (
  value: TemplateStringsArray | ShellOptions,
): value is TemplateStringsArray => Array.isArray(value);

const shellInterpolate = (value: ShellTemplateExpression): string =>
  Array.isArray(value)
    ? value.map((item) => Bash.quote(String(item))).join(" ")
    : Bash.quote(String(value));

const makeShellCommand = (
  strings: TemplateStringsArray,
  values: ReadonlyArray<ShellTemplateExpression>,
  options: ShellOptions = {},
) => {
  let script = strings[0] ?? "";
  for (const [index, value] of values.entries()) {
    script += shellInterpolate(value);
    script += strings[index + 1] ?? "";
  }

  return {
    command: "sh",
    args: ["-c", script],
    ...options,
  } satisfies Command;
};

export type SandboxPromise = Readonly<{
  $: {
    (strings: TemplateStringsArray, ...values: any[]): Promise<string>;
    (options: ShellOptions): (strings: TemplateStringsArray, ...values: any[]) => Promise<string>;
  };
  cmd(command: Command): Promise<Handle>;
  readFile(options: Readonly<{ sandboxPath: string }>): Promise<string>;
  writeFile(options: Readonly<{ sandboxPath: string; content: string }>): Promise<void>;
  download(options: Readonly<{ sandboxPath: string; hostPath: string }>): Promise<void>;
  upload(options: Readonly<{ sandboxPath: string; hostPath: string }>): Promise<void>;
  expose(
    options: Readonly<{ sandboxPort: number; hostPort?: number }>,
  ): Promise<{ hostUrl: string }>;
}>;

export const asPromise = Effect.fn(function* (sandbox: Sandbox) {
  const runPromise = yield* FiberSet.makeRuntimePromise();

  const runShell = async (
    strings: TemplateStringsArray,
    values: ReadonlyArray<ShellTemplateExpression>,
    options?: ShellOptions,
  ) => {
    const handle = await runPromise(sandbox.cmd(makeShellCommand(strings, values, options)));
    return handle.stdout ?? "";
  };

  function $(
    strings: TemplateStringsArray,
    ...values: ReadonlyArray<ShellTemplateExpression>
  ): Promise<string>;
  function $(
    options: ShellOptions,
  ): (
    strings: TemplateStringsArray,
    ...values: ReadonlyArray<ShellTemplateExpression>
  ) => Promise<string>;
  function $(
    first: TemplateStringsArray | ShellOptions,
    ...values: ReadonlyArray<ShellTemplateExpression>
  ) {
    if (isTemplateStringsArray(first)) {
      return runShell(first, values);
    }

    const options = first;
    return (
      strings: TemplateStringsArray,
      ...innerValues: ReadonlyArray<ShellTemplateExpression>
    ) => runShell(strings, innerValues, options);
  }

  const cmd: SandboxPromise["cmd"] = ({ command, args, cwd, env }) =>
    runPromise(sandbox.cmd({ command, args, cwd, env }));

  const readFile: SandboxPromise["readFile"] = (options) => runPromise(sandbox.readFile(options));

  const writeFile: SandboxPromise["writeFile"] = (options) =>
    runPromise(sandbox.writeFile(options));

  const download: SandboxPromise["download"] = (options) => runPromise(sandbox.download(options));

  const upload: SandboxPromise["upload"] = (options) => runPromise(sandbox.upload(options));

  const expose: SandboxPromise["expose"] = (options) => runPromise(sandbox.expose(options));

  return {
    $,
    cmd,
    readFile,
    writeFile,
    download,
    upload,
    expose,
  } satisfies SandboxPromise;
});
