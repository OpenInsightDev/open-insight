import { Sandbox } from "@open-insight/core";
import { Schema } from "effect";
import { Tool } from "effect/unstable/ai";

export const Command = Tool.make("Command", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Sandbox.Sandbox],
});

export const Shell = Tool.make("Shell", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Sandbox.Sandbox],
});

export const ListSessions = Tool.make("ListSessions", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Sandbox.Sandbox],
});

export const OpenSession = Tool.make("OpenSession", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Sandbox.Sandbox],
});

export const CloseSession = Tool.make("CloseSession", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Sandbox.Sandbox],
});

export const SendToSession = Tool.make("SendToSession", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Sandbox.Sandbox],
});

export const ReceiveFromSession = Tool.make("ReceiveFromSession", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
  dependencies: [Sandbox.Sandbox],
});
