import type { Prompt, Sandbox } from "@open-insight/core/internal";
import { Data, Effect, Option, Schema } from "effect";
import { ContextError } from "./error.ts";

export type AfterRespondState = Sandbox.Sandbox &
  Readonly<{
    trajectory: Prompt.Trajectory;
    responded: Prompt.Prompt;
  }>;

export type AfterRespondResult = Readonly<{
  trajectory: Prompt.Trajectory;
  responded: Prompt.Prompt;
}>;
export type AfterRespondFn = (
  state: AfterRespondState,
) => Effect.Effect<AfterRespondResult, unknown>;

export type PrePromptState = Sandbox.Sandbox &
  Readonly<{
    trajectory: Prompt.Trajectory;
    prompt: Prompt.Prompt;
  }>;

export type PrePromptResult = Readonly<{
  trajectory: Prompt.Trajectory;
  prompt: Prompt.Prompt;
}>;
export type PrePromptFn = (state: PrePromptState) => Effect.Effect<PrePromptResult, unknown>;

export type Fn = Data.TaggedEnum<{
  PrePrompt: { fn: PrePromptFn };
  AfterRespond: { fn: AfterRespondFn };
}>;
export const Fn = Data.taggedEnum<Fn>();

export const toolMessages = (prompt: Prompt.Prompt): ReadonlyArray<Prompt.ToolMessage> => {
  return prompt.content.filter((message): message is Prompt.ToolMessage => message.role === "tool");
};

export const userMessage = (prompt: Prompt.Prompt): Option.Option<Prompt.UserMessage> => {
  const msg = prompt.content.at(0);
  const len = prompt.content.length;

  if (len === 1 && msg && msg.role === "user") {
    return Option.some(msg);
  }

  return Option.none();
};

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  name: Schema.String,
  description: Schema.optional(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export type Middleware = Readonly<{
  metadata: Metadata;
  fn: Fn;
}>;

type Options = MetadataEncoded;

export const make = Effect.fn(function* (fn: Fn, options: Options) {
  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError((cause) => ContextError.invalidMetadata(cause)),
  );
  return { metadata, fn } as Middleware;
});

export const makeAfterRespond = (fn: AfterRespondFn, options: Options) =>
  make(Fn.AfterRespond({ fn }), options);

export const makePrePrompt = (fn: PrePromptFn, options: Options) =>
  make(Fn.PrePrompt({ fn }), options);
