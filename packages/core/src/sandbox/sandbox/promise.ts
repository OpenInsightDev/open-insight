import { Effect, FiberSet } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import type { Error } from "../error.ts";
import type { Sandbox } from "./index.ts";

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
  ): Promise<{ stdout: string; stderr: string }>;
  readFile(options: Readonly<{ sandboxPath: string }>): Promise<string>;
  writeFile(options: Readonly<{ sandboxPath: string; content: string }>): Promise<void>;
  download(options: Readonly<{ sandboxPath: string; hostPath: string }>): Promise<void>;
  upload(options: Readonly<{ sandboxPath: string; hostPath: string }>): Promise<void>;
  expose(
    options: Readonly<{ sandboxPort: number; hostPort: number }>,
  ): Promise<{ hostUrl: string }>;
}>;

export const asPromise = Effect.fn(function* (sandbox: Sandbox) {
  const runPromise = yield* FiberSet.makeRuntimePromise<never, unknown, Error>();

  // TODO use /bin/sh '$SHELL' -c '...' to run commands
  const $ = ((first: TemplateStringsArray | CP.CommandOptions, ...values: any[]) => {
    if (Array.isArray(first) && "raw" in first) {
      return runPromise(sandbox.$(CP.make(first, ...values)));
    }
    const commandMaker = CP.make(first as CP.CommandOptions);
    return (strings: TemplateStringsArray, ...vals: any[]) =>
      runPromise(sandbox.$(commandMaker(strings, ...vals)));
  }) as SandboxPromise["$"];

  const cmd: SandboxPromise["cmd"] = (options) =>
    runPromise(
      sandbox.$(
        CP.make(options.command, options.args ?? [], { cwd: options.cwd, env: options.env }),
      ),
    ).then((stdout) => ({ stdout, stderr: "" }));

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
