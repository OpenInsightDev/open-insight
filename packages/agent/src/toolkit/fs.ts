import { Sandbox } from "@open-insight/core";
import { Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

export const OpenFile = Tool.make("OpenFile", {
  parameters: Schema.Struct({
    filePath: Schema.String,
    space: Schema.optional(Schema.String),
    startLine: Schema.optional(Schema.Number),
    endLine: Schema.optional(Schema.Number),
  }),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Sandbox.Sandbox],
});

export const CloseFile = Tool.make("CloseFile", {
  parameters: Schema.Struct({
    filePath: Schema.String,
    space: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Sandbox.Sandbox],
});

export const Search = Tool.make("Search", {
  parameters: Schema.Struct({
    path: Schema.String,
    pattern: Schema.String,
    space: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Sandbox.Sandbox],
});

export const Glob = Tool.make("Glob", {
  parameters: Schema.Struct({
    path: Schema.String,
    pattern: Schema.String,
    space: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Sandbox.Sandbox],
});

export const Patch = Tool.make("Patch", {
  parameters: Schema.Struct({
    filePath: Schema.String,
    diff: Schema.String,
    space: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Sandbox.Sandbox],
});

export const Remove = Tool.make("Remove", {
  parameters: Schema.Struct({
    space: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Sandbox.Sandbox],
});

export const ListDirectory = Tool.make("ListDirectory", {
  parameters: Schema.Struct({
    dirPath: Schema.String,
    depth: Schema.optional(Schema.Number),
    space: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Sandbox.Sandbox],
});

export const FileSystemToolkit = Toolkit.make(OpenFile, CloseFile, Search, Glob, Patch);
