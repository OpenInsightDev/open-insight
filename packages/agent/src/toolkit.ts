import { Sandbox } from "@open-insight/core";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

export const Execute = Tool.make("SandboxExecute", {
  description: "Execute a command in the sandbox and return its exit code, stdout, and stderr.",
  parameters: Schema.Struct({
    command: Schema.String,
    args: Schema.optionalKey(Schema.Array(Schema.String)),
    cwd: Schema.optionalKey(Schema.String),
    env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  }),
  success: Schema.Struct({
    exitCode: Schema.Number,
    stdout: Schema.String,
    stderr: Schema.String,
  }),
  failure: Schema.String,
  failureMode: "return",
  dependencies: [Sandbox.Current],
});

export const ReadFile = Tool.make("SandboxReadFile", {
  description: "Read a UTF-8 text file from the sandbox.",
  parameters: Schema.Struct({
    sandboxPath: Schema.String,
  }),
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
  dependencies: [Sandbox.Current],
});

export const WriteFile = Tool.make("SandboxWriteFile", {
  description: "Write a UTF-8 text file in the sandbox, replacing any existing content.",
  parameters: Schema.Struct({
    sandboxPath: Schema.String,
    content: Schema.String,
  }),
  success: Schema.Struct({
    sandboxPath: Schema.String,
  }),
  failure: Schema.String,
  failureMode: "return",
  dependencies: [Sandbox.Current],
});

export const toolkit = Toolkit.make(Execute, ReadFile, WriteFile);
export type Tools = Toolkit.Tools<typeof toolkit>;

export const layer = toolkit.toLayer({
  SandboxExecute: Effect.fn(function* ({ command, args, cwd, env }) {
    const sandbox = yield* Sandbox.Current;
    return yield* sandbox
      .spawn(
        {
          command,
          args: args === undefined ? undefined : Array.from(args),
          cwd,
          env: env === undefined ? undefined : { ...env },
        },
        { errorOnNonZeroExit: false },
      )
      .pipe(
        Effect.map(({ exitCode, stdout, stderr }) => ({ exitCode, stdout, stderr })),
        Effect.mapError((error) => error.message),
      );
  }),
  SandboxReadFile: Effect.fn(function* ({ sandboxPath }) {
    const sandbox = yield* Sandbox.Current;
    return yield* sandbox.readFile({ sandboxPath }).pipe(Effect.mapError((error) => error.message));
  }),
  SandboxWriteFile: Effect.fn(function* ({ sandboxPath, content }) {
    const sandbox = yield* Sandbox.Current;
    return yield* sandbox.writeFile({ sandboxPath, content }).pipe(
      Effect.as({ sandboxPath }),
      Effect.mapError((error) => error.message),
    );
  }),
});
