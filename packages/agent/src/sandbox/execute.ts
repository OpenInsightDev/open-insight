import { Sandbox } from "@open-insight/core";
import { Effect, Option, Schema, SchemaIssue, SchemaTransformation } from "effect";
import { Tool } from "effect/unstable/ai";

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

export const Execute = Tool.make("Execute", {
  description:
    "Execute a program and return its exit code, stdout, and stderr. " +
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
