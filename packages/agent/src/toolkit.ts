import { Sandbox } from "@open-insight/core";
import { Effect, Inspectable, Option, Schema, SchemaIssue, SchemaTransformation } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

const EnvironmentEntry = Schema.Struct({
  name: Schema.NonEmptyString,
  value: Schema.String,
});

const Environment = Schema.Array(EnvironmentEntry)
  .pipe(
    Schema.decodeTo(
      Schema.Record(Schema.String, Schema.String),
      SchemaTransformation.transformOrFail({
        decode: (entries) => {
          const environment: Record<string, string> = {};
          for (const { name, value } of entries) {
            if (Object.hasOwn(environment, name)) {
              return Effect.fail(
                new SchemaIssue.InvalidValue(Option.some(entries), {
                  message: `Duplicate environment variable: ${name}`,
                }),
              );
            }
            environment[name] = value;
          }
          return Effect.succeed(environment);
        },
        encode: (environment) =>
          Effect.succeed(Object.entries(environment).map(([name, value]) => ({ name, value }))),
      }),
    ),
  )
  .annotate({
    description: "Environment variables as entries with unique, non-empty names.",
  });

const formatUnknownCause = (cause: unknown): string =>
  cause instanceof globalThis.Error
    ? `${cause.name}: ${cause.message}`
    : Inspectable.toStringUnknown(cause);

const formatSandboxError = (error: unknown): string => {
  if (error instanceof Sandbox.Error) {
    const reason = error.reason;
    if (reason._tag === "SandboxExecError") {
      return `${reason._tag}: ${reason.operation}\n${formatUnknownCause(reason.cause)}`;
    }
    return `${reason._tag}: ${Inspectable.toStringUnknown(reason)}`;
  }
  return Inspectable.toStringUnknown(error);
};

export const Execute = Tool.make("SandboxExecute", {
  description:
    "Execute a program in the sandbox and return its exit code, stdout, and stderr. " +
    "command must be one executable name without arguments or shell syntax. Put each argument " +
    'in args. For a shell expression, use command "sh" and args ["-c", "..."] instead.',
  parameters: Schema.Struct({
    command: Schema.String,
    args: Schema.optionalKey(Schema.Array(Schema.String)),
    cwd: Schema.optionalKey(Schema.String),
    env: Schema.optionalKey(Environment),
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
  description: "Read an existing UTF-8 text file from the sandbox using its absolute path.",
  parameters: Schema.Struct({
    sandboxPath: Schema.String,
  }),
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
  dependencies: [Sandbox.Current],
});

export const WriteFile = Tool.make("SandboxWriteFile", {
  description:
    "Write a UTF-8 text file in the sandbox, replacing any existing content. Use an absolute " +
    "path whose parent directory already exists.",
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
        Effect.mapError(formatSandboxError),
      );
  }),
  SandboxReadFile: Effect.fn(function* ({ sandboxPath }) {
    const sandbox = yield* Sandbox.Current;
    return yield* sandbox.readFile({ sandboxPath }).pipe(Effect.mapError(formatSandboxError));
  }),
  SandboxWriteFile: Effect.fn(function* ({ sandboxPath, content }) {
    const sandbox = yield* Sandbox.Current;
    return yield* sandbox
      .writeFile({ sandboxPath, content })
      .pipe(Effect.as({ sandboxPath }), Effect.mapError(formatSandboxError));
  }),
});
