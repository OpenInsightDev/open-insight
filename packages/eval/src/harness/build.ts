import { Agent, Sandbox } from "@open-insight/core/internal";

import { Effect, Layer, Schema } from "effect";
import type { Config } from "./config.ts";

export class Metadata extends Schema.Class<Metadata>("HarnessMetadata")({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
}) {}

export class Harness {
  constructor(
    public metadata: Metadata,
    public config: Config,
    public layer: Layer.Layer<Agent.ProviderService | Sandbox.ProviderService>,
  ) {}

  get name(): string {
    return this.metadata.name;
  }
}

export const make = Effect.fn(function* ({
  name,
  config,
  description,
}: {
  name: string;
  config?: Config;
  description?: string;
}): Effect.fn.Return<Harness, never, Agent.ProviderService | Sandbox.ProviderService> {
  const agent = yield* Agent.ProviderService;
  const sandbox = yield* Sandbox.ProviderService;

  return new Harness(
    new Metadata({
      name,
      description: description ?? null,
    }),
    config ?? {},
    Layer.mergeAll(
      Layer.succeed(Agent.ProviderService)(agent),
      Layer.succeed(Sandbox.ProviderService)(sandbox),
    ),
  );
});
