import { Context, Effect, Layer } from "effect";

export type Agent = Readonly<{}>;

export class Service extends Context.Service<Service, Agent>()("open-insight/Agent") {
  static layer = Layer.effect(
    this,
    Effect.gen(function* () {
      throw new Error("Agent service is not implemented yet");
    }),
  );
}
