import { Context, Effect, Layer, Option } from "effect";
import { Prompt } from "effect/unstable/ai";
import * as Sandbox from "#/sandbox/index.ts";
import { PromptError } from "../error.ts";
import type { Trajectory } from "../traj.ts";

export type Respond = Readonly<{
  init: Prompt.Prompt;
  respond: (trajectory: Trajectory) => Effect.Effect<Option.Option<Prompt.Prompt>, PromptError>;
}>;

export class Service extends Context.Service<
  Service,
  {
    make(sandbox: Sandbox.ReadonlySandbox): Effect.Effect<Respond, PromptError>;
  }
>()("RespondService") {}

export type Options = Readonly<{
  init: Prompt.RawInput;
  respond?: (
    sandbox: Sandbox.ReadonlySandbox,
  ) => (trajectory: Trajectory) => Effect.Effect<Option.Option<Prompt.RawInput>, unknown>;
}>;
const defaultRespond: Options["respond"] = () => () => Effect.succeed(Option.none());

export const make = ({ init: initOption, respond: respondOption = defaultRespond }: Options) => {
  const init = Prompt.make(initOption);

  return {
    make: Effect.fn(function* (sandbox) {
      const respond = respondOption(sandbox);
      return {
        init,
        respond: Effect.fn(function* (trajectory) {
          const raw = yield* respond(trajectory).pipe(Effect.mapError(PromptError.generate));
          return raw.pipe(Option.map(Prompt.make));
        }),
      };
    }),
  } satisfies Service["Service"];
};

export const layerFrom = (options: Options): Layer.Layer<Service> =>
  Layer.effect(Service, Effect.succeed(make(options)));
