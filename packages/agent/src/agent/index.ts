import { Context, Effect, Layer } from "effect";
import * as History from "#/history/index.ts";

export type Agent = Readonly<{}>;

export class Service extends Context.Service<Service, Agent>()("open-insight/Agent") {
  static layer: Layer.Layer<Service, never, History.Service> = Layer.effect(
    this,
    Effect.gen(function* () {
      const history = yield* History.Service;
      return {};
    }),
  );
}
