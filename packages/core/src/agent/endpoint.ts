import { Schema, Redacted } from "effect";

export class Endpoint extends Schema.Class<Endpoint>("Endpoint")({
  baseUrl: Schema.String,
  apiKey: Schema.Redacted(Schema.String),
  type: Schema.Union([Schema.Literal("openai"), Schema.Literal("anthropic")]),
}) {
  static makeOpenAI = ({
    baseUrl = "https://api.openai.com/v1",
    apiKey = process.env.OPENAI_API_KEY,
  }: {
    baseUrl?: string;
    apiKey?: string;
  } = {}) => {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set and environment variable is not available");
    }
    return new Endpoint({ baseUrl, apiKey: Redacted.make(apiKey), type: "openai" });
  };

  static makeAnthropic = ({
    baseUrl = "https://api.anthropic.com/v1",
    apiKey = process.env.ANTHROPIC_API_KEY,
  }: {
    baseUrl?: string;
    apiKey?: string;
  } = {}) => {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set and environment variable is not available");
    }
    return new Endpoint({ baseUrl, apiKey: Redacted.make(apiKey), type: "anthropic" });
  };
}
