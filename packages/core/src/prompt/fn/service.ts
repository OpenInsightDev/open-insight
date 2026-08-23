import { Context, Effect, Layer, Option } from "effect";
import { Prompt } from "effect/unstable/ai";
import * as Sandbox from "#/sandbox/index.ts";
import { PromptError } from "../error.ts";
import type { Trajectory } from "../traj.ts";

export type Context = Sandbox.ReadonlySandboxPromise;

type Respond = (trajectory: Trajectory) => PromiseLike<Prompt.RawInput | null>;
export type Fn = Readonly<{
  init: Prompt.Prompt;
  respond: Respond;
}>;
export class Service extends Context.Service<Service, Fn>()("PromptingService") {}

export type Init = (context: Context) => Fn;

type RespondFn = (
  context: Context,
) => (trajectory: Trajectory) => PromiseLike<Prompt.RawInput | null>;
const defaultRespond: RespondFn = () => async () => null;

type Options = Readonly<{
  init: Prompt.RawInput;
  respond?: RespondFn;
}>;
export const make = ({ init, respond = defaultRespond }: Options) =>
  Effect.fn(function* (context: Context) {
    const respGen = yield* Effect.tryPromise({
      try: async () => respond(context),
      catch: PromptError.generation,
    });

    return {
      init: Prompt.make(init),
      respond: (trajectory: Trajectory) =>
        Effect.tryPromise({
          try: () => respGen(trajectory),
          catch: PromptError.generation,
        }).pipe(Effect.map(Option.fromNullOr), Effect.map(Option.map(Prompt.make))),
    } satisfies Fn;
  });

export const layerFrom = (options: Options, context: Context) =>
  Layer.effect(Service, make(options)(context));
