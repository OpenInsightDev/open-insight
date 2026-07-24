import { Agent, Sandbox } from "@open-insight/core/internal";

import { Effect, Layer, Schema } from "effect";
import type { Config } from "./config.ts";

export class BaseMetadata extends Schema.Class<BaseMetadata>("HarnessBaseMetadata")({
  id: Schema.String,
  extras: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
}) {}
type BaseMetadataEncoded = Schema.Codec.Encoded<typeof BaseMetadata>;

export class Metadata extends Schema.Class<Metadata>("HarnessMetadata")({
  base: BaseMetadata,
}) {}

export type Harness = Readonly<{
  metadata: BaseMetadata;
  config: Config;
  layer: Layer.Layer<Agent.ProviderService | Sandbox.ProviderService>;
}>;

type Options = BaseMetadataEncoded &
  Readonly<{
    config?: Config;
  }>;

export const make = Effect.fn(function* (options: Options) {
  const agent = yield* Agent.ProviderService;
  const sandbox = yield* Sandbox.ProviderService;
  const metadata = yield* Schema.decodeEffect(BaseMetadata)(options).pipe();

  const { config = {} } = options;

  const layer = Layer.mergeAll(
    Layer.succeed(Agent.ProviderService, agent),
    Layer.succeed(Sandbox.ProviderService, sandbox),
  );

  return {
    metadata,
    config,
    layer,
  } satisfies Harness;
});

export const metadata = (harness: Harness): Metadata =>
  Metadata.make({ base: harness.metadata }, { parseOptions: { onExcessProperty: "ignore" } });
