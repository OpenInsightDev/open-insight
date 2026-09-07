import * as Fs from "#/fs/index.ts";
import { Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

export const OpenFile = Tool.make("OpenFile", {
  parameters: Schema.Struct({
    space: Schema.String,
  }),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Fs.FileSystem],
});

export const CloseFile = Tool.make("CloseFile", {
  parameters: Schema.Struct({
    space: Schema.String,
  }),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Fs.FileSystem],
});

export const Search = Tool.make("Search", {
  parameters: Schema.Struct({
    space: Schema.String,
  }),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Fs.FileSystem],
});

export const Patch = Tool.make("Patch", {
  parameters: Schema.Struct({
    space: Schema.String,
  }),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Fs.FileSystem],
});

export const InspectParams = Schema.Struct({
  absPath: Schema.String,
  space: Schema.String,
});

export const InspectItem = Schema.Struct({
  absPath: Schema.String,
});

export const InspectSuccess = Schema.Struct({});

export const Inspect = Tool.make("Inspect", {
  parameters: InspectParams,
  success: InspectSuccess,
  failureMode: "return",
  needsApproval: false,
  dependencies: [Fs.FileSystem],
});

export const FileSystemToolkit = Toolkit.make(OpenFile, CloseFile, Patch);
