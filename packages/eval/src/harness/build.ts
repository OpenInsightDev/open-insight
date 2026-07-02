import { Agent, Sandbox } from "@open-insight/core/internal";

import { Effect, Layer, Schema } from "effect";
import type { Config } from "./config.ts";

export class Metadata extends Schema.Class<Metadata>("HarnessMetadata")({
  name: Schema.String,
  description: Schema.optional(Schema.String),
}) {}

export type Harness = Metadata &
  Readonly<{
    config: Config;
    layer: Layer.Layer<Agent.ProviderService | Sandbox.ProviderService>;
  }>;

type Options = Metadata &
  Readonly<{
    config?: Config;
  }>;

export const make = Effect.fn(function* ({
  config,
  ...metadata
}: Options): Effect.fn.Return<Harness, never, Agent.ProviderService | Sandbox.ProviderService> {
  const agent = yield* Agent.ProviderService;
  const sandbox = yield* Sandbox.ProviderService;

  return {
    ...metadata,
    config: config ?? {},
    layer: Layer.mergeAll(
      Layer.succeed(Agent.ProviderService)(agent),
      Layer.succeed(Sandbox.ProviderService)(sandbox),
    ),
  } satisfies Harness;
});
