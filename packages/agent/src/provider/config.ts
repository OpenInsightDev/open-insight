import { NodeFileSystem } from "@effect/platform-node";
import { Config as EffectConfig, ConfigProvider, Effect, Layer, Redacted } from "effect";

export type Config = Readonly<{
  apiKey: EffectConfig.Config<string>;
  baseUrl: EffectConfig.Config<string>;
  dotenvPath: string;
  model: string;
}>;

export type Endpoint = Readonly<{
  apiKey: string;
  baseUrl: string;
  model: string;
}>;

export type ResolvedConfig = Readonly<{
  apiKey: Redacted.Redacted<string>;
  baseUrl: string;
  model: string;
}>;

export const resolveConfig = Effect.fn("Agent.resolveProviderConfig")(function* (config: Config) {
  const envLayer = ConfigProvider.layer(
    ConfigProvider.fromDotEnv({ path: config.dotenvPath }),
  ).pipe(Layer.provide(NodeFileSystem.layer));

  const values = yield* EffectConfig.all({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  }).pipe(Effect.provide(envLayer));

  return { ...values, apiKey: Redacted.make(values.apiKey), model: config.model };
});
