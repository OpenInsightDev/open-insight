import { Sandbox } from "@open-insight/core";
import { Schema } from "effect";
import { Tool } from "effect/unstable/ai";

export const Execute = Tool.make("Execute", {
  description:
    "Execute a program and return its exit code, stdout, and stderr. " +
    "command must be one executable name without arguments or shell syntax. Put each argument " +
    'in args. For a shell expression, use command "sh" and args ["-c", "..."] instead.',
  parameters: Schema.Struct({
    command: Schema.String,
    args: Schema.optionalKey(Schema.Array(Schema.String)),
    cwd: Schema.optionalKey(Schema.String),
    env: Schema.UndefinedOr(Schema.Record(Schema.String, Schema.String)),
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
