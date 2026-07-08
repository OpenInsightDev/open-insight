import { Schema } from "effect";

export class Config extends Schema.Class<Config>("SandboxConfig")({
  cacheTaskSnapshot: Schema.optional(Schema.Boolean),
  cacheAgentSnapshot: Schema.optional(Schema.Boolean),
}) {}
