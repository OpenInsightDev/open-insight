import { Schema } from "effect";
import { Tool } from "effect/unstable/ai";

export const ReadFile = Tool.make("ReadFile", {
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  failureMode: "return",
  needsApproval: false,
});
