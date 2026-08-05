import { Sandbox } from "@open-insight/core";
import { Schema } from "effect";
import { Tool } from "effect/unstable/ai";

export const ReadFile = Tool.make("ReadFile", {
  description: "Read an existing UTF-8 text file using its absolute path.",
  parameters: Schema.Struct({
    path: Schema.String,
  }),
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
  dependencies: [Sandbox.Current],
});

export const WriteFile = Tool.make("WriteFile", {
  description:
    "Write a UTF-8 text file, replacing any existing content. Use an absolute path whose parent " +
    "directory already exists.",
  parameters: Schema.Struct({
    path: Schema.String,
    content: Schema.String,
  }),
  success: Schema.Struct({
    path: Schema.String,
  }),
  failure: Schema.String,
  failureMode: "return",
  dependencies: [Sandbox.Current],
});
