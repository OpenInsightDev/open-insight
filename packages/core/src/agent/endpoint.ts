import { Schema, Redacted } from "effect";

export class Endpoint extends Schema.Class<Endpoint>("Endpoint")({
  model: Schema.String,
  baseUrl: Schema.String,
  apiKey: Schema.Redacted(Schema.String),
  type: Schema.Union([Schema.Literal("openai"), Schema.Literal("anthropic")]),
}) {
  makeOpenAI = ({
    model,
    baseUrl = "https://api.openai.com/v1",
    apiKey = process.env.OPENAI_API_KEY,
  }: {
    model: string;
    baseUrl?: string;
    apiKey?: string;
  }) => {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }
    return new Endpoint({ model, baseUrl, apiKey: Redacted.make(apiKey), type: "openai" });
  };

  makeAnthropic = ({
    model,
    baseUrl = "https://api.anthropic.com/v1",
    apiKey = process.env.ANTHROPIC_API_KEY,
  }: {
    model: string;
    baseUrl?: string;
    apiKey?: string;
  }) => {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set");
    }
    return new Endpoint({ model, baseUrl, apiKey: Redacted.make(apiKey), type: "anthropic" });
  };
}
