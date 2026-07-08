import { Effect, FiberSet } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { Bash } from "../../utils/index.ts";
import type { Sandbox, CmdHandle } from "./index.ts";

type ShellTemplateValue = string | number | boolean;
type ShellTemplateExpression = ShellTemplateValue | ReadonlyArray<ShellTemplateValue>;

const isTemplateStringsArray = (
  value: TemplateStringsArray | CP.CommandOptions,
): value is TemplateStringsArray => Array.isArray(value);

const shellInterpolate = (value: ShellTemplateExpression): string =>
  Array.isArray(value)
    ? value.map((item) => Bash.quote(String(item))).join(" ")
    : Bash.quote(String(value));

const makeShellCommand = (
  strings: TemplateStringsArray,
  values: ReadonlyArray<ShellTemplateExpression>,
  options: CP.CommandOptions = {},
) => {
  let script = strings[0] ?? "";
  for (const [index, value] of values.entries()) {
    script += shellInterpolate(value);
    script += strings[index + 1] ?? "";
  }

  return CP.make("sh", ["-c", script], options);
};

export type SandboxPromise = Readonly<{
  $: {
    (strings: TemplateStringsArray, ...values: any[]): Promise<string>;
    (
      options: CP.CommandOptions,
    ): (strings: TemplateStringsArray, ...values: any[]) => Promise<string>;
  };
  cmd(
    options: Readonly<{
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
    }>,
  ): Promise<CmdHandle>;
  readFile(options: Readonly<{ sandboxPath: string }>): Promise<string>;
  writeFile(options: Readonly<{ sandboxPath: string; content: string }>): Promise<void>;
  download(options: Readonly<{ sandboxPath: string; hostPath: string }>): Promise<void>;
  upload(options: Readonly<{ sandboxPath: string; hostPath: string }>): Promise<void>;
  expose(
    options: Readonly<{ sandboxPort: number; hostPort: number }>,
  ): Promise<{ hostUrl: string }>;
}>;

export const asPromise = Effect.fn(function* (sandbox: Sandbox) {
  const runPromise = yield* FiberSet.makeRuntimePromise();

  const runShell = async (
    strings: TemplateStringsArray,
    values: ReadonlyArray<ShellTemplateExpression>,
    options?: CP.CommandOptions,
  ) => {
    const handle = await runPromise(sandbox.cmd(makeShellCommand(strings, values, options)));
    return handle.stdout ?? "";
  };

  function $(
    strings: TemplateStringsArray,
    ...values: ReadonlyArray<ShellTemplateExpression>
  ): Promise<string>;
  function $(
    options: CP.CommandOptions,
  ): (
    strings: TemplateStringsArray,
    ...values: ReadonlyArray<ShellTemplateExpression>
  ) => Promise<string>;
  function $(
    first: TemplateStringsArray | CP.CommandOptions,
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
    runPromise(sandbox.cmd(CP.make(command, args ?? [], { cwd, env })));

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
