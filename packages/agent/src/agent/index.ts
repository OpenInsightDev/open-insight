import { Sandbox, type Prompt } from "@open-insight/core/internal";
import { Context, Effect, Layer, Ref, Stream } from "effect";
import { Response, Tool, Toolkit } from "effect/unstable/ai";
import * as Traj from "#/trajectory/index.ts";

export type State = Readonly<{
  trajectory: Ref.Ref<Prompt.Trajectory>;
  responses: Array<Prompt.Part>;
}>;

export type Session<Tools extends Record<string, Tool.Any>> = Readonly<{
  toolkit: Toolkit.Toolkit<Tools>;
  trajectory: Ref.Ref<Prompt.Trajectory>;
  prompt(prompt: Prompt.Prompt): Stream.Stream<Response.StreamPart<Tools>>;
}>;

type Agent = Readonly<{
  createSession<Tools extends Record<string, Tool.Any>>(
    toolkit: Toolkit.Toolkit<Tools>,
  ): Effect.Effect<Session<Tools>>;
}>;

export class Service extends Context.Service<Service, Agent>()("open-insight/Agent") {}

export const layerFrom = () =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.ProviderService;
      const traj = yield* Traj.Service;
      throw new Error("no");
    }),
  );
