import { Schema, Terminal } from "effect";
import { Tool } from "effect/unstable/ai";
import { ChildProcessSpawner } from "effect/unstable/process";

export const Command = Tool.make("Command", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [ChildProcessSpawner.ChildProcessSpawner],
});

export const Shell = Tool.make("Shell", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [ChildProcessSpawner.ChildProcessSpawner],
});

export const Send = Tool.make("Send", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Terminal.Terminal],
});

export const Receive = Tool.make("Receive", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Terminal.Terminal],
});
