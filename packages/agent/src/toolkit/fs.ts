import { FileSystem, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

export const OpenFile = Tool.make("OpenFile", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [FileSystem.FileSystem],
});

export const CloseFile = Tool.make("CloseFile", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [FileSystem.FileSystem],
});

export const Patch = Tool.make("Patch", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [FileSystem.FileSystem],
});

export const FileSystemToolkit = Toolkit.make(OpenFile, CloseFile, Patch);
