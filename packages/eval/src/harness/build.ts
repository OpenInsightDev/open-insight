import { Agent, Sandbox } from "@open-insight/core/internal";

import { Effect, Layer, Schema } from "effect";
import type { Config } from "./config.ts";

export class Metadata extends Schema.Class<Metadata>("HarnessMetadata")({
  id: Schema.String,
  name: Schema.String,
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export type Harness = Readonly<{
  metadata: Metadata;
  config: Config;
  layer: Layer.Layer<Agent.ProviderService | Sandbox.ProviderService>;
}>;

type Options = MetadataEncoded &
  Readonly<{
    config?: Config;
  }>;

export const make = Effect.fn(function* (
  options: Options,
): Effect.fn.Return<Harness, never, Agent.ProviderService | Sandbox.ProviderService> {
  const agent = yield* Agent.ProviderService;
  const sandbox = yield* Sandbox.ProviderService;
  const metadata = Schema.decodeSync(Metadata)(options);

  const { config = {} } = options;

  const layer = Layer.mergeAll(
    Layer.succeed(Agent.ProviderService, agent),
    Layer.succeed(Sandbox.ProviderService, sandbox),
  );

  return {
    metadata,
    config,
    layer,
  };
});
