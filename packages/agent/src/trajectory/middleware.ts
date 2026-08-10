import type { Prompt } from "@open-insight/core/internal";
import { Effect, Option, Schema } from "effect";

export type State = Readonly<{
  trajectory: Prompt.Trajectory;
  responses: Array<Prompt.Part>;
}>;

export type Fn = (state: State) => Effect.Effect<Option.Option<State>>;

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
  const metadata = yield* Schema.decodeEffect(Metadata)(options);
  return { metadata, fn } as Middleware;
});
