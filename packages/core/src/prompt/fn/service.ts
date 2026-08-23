import { Context, Effect, Layer, Option } from "effect";
import { Prompt } from "effect/unstable/ai";
import * as Sandbox from "#/sandbox/index.ts";
import { PromptError } from "../error.ts";
import type { Trajectory } from "../traj.ts";

export type Context = Sandbox.ReadonlySandboxPromise;

type RespGen = (trajectory: Trajectory) => PromiseLike<Prompt.RawInput | null>;
type Gen = (context: Context) => RespGen | PromiseLike<RespGen>;
const defaultGen: Gen = () => async () => null;

export type Fn = Readonly<{
  init: Prompt.Prompt;
  prompt(trajectory: Trajectory): Effect.Effect<Option.Option<Prompt.Prompt>, PromptError>;
}>;

export class Service extends Context.Service<Service, Fn>()("PromptingService") {}

type Options = Readonly<{
  init: Prompt.RawInput;
  gen?: Gen;
  context: Context;
}>;
export const make = Effect.fn(function* ({ init, gen = defaultGen, context }: Options) {
  const respGen = yield* Effect.tryPromise({
    try: async () => await gen(context),
    catch: PromptError.generation,
  });

  const prompt = (trajectory: Trajectory) =>
    Effect.tryPromise({
      try: () => respGen(trajectory),
      catch: PromptError.generation,
    }).pipe(Effect.map(Option.fromNullOr), Effect.map(Option.map(Prompt.make)));

  return { init: Prompt.make(init), prompt } satisfies Fn;
});

export const layerFrom = (options: Options) => Layer.effect(Service, make(options));
