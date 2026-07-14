import { Agent, Sandbox } from "@open-insight/core/internal";

import { Effect, Layer, Schema } from "effect";
import type { Config } from "./config.ts";
import { immerable } from "immer";

export class Metadata extends Schema.Class<Metadata>("HarnessMetadata")({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
}) {
  [immerable] = true;
}

export type Harness = Metadata &
  Readonly<{
    config: Config;
    layer: Layer.Layer<Agent.ProviderService | Sandbox.ProviderService>;
  }>;

export const make = Effect.fn(function* ({
  id,
  name,
  description,
  config,
}: {
  id: string;
  name: string;
  description?: string;
  config?: Config;
}): Effect.fn.Return<Harness, never, Agent.ProviderService | Sandbox.ProviderService> {
  const agent = yield* Agent.ProviderService;
  const sandbox = yield* Sandbox.ProviderService;

  return Object.assign(
    Metadata.make({
      id,
      name,
      description: description ?? null,
    }),
    {
      config: config ?? {},
      layer: Layer.mergeAll(
        Layer.succeed(Agent.ProviderService)(agent),
        Layer.succeed(Sandbox.ProviderService)(sandbox),
      ),
    },
  );
});
