import { Context, Effect, Layer, Option } from "effect";
import { Prompt } from "effect/unstable/ai";
import * as Sandbox from "#/sandbox/index.ts";
import { PromptError } from "./error.ts";
import type { Trajectory } from "./traj.ts";

export type Context = Sandbox.ReadonlySandboxPromise;

type RespFn = (trajectory: Trajectory) => PromiseLike<Prompt.RawInput | null>;
type Fn = (context: Context) => RespFn | PromiseLike<RespFn>;
export type Options = Readonly<{
  init: Prompt.RawInput;
  fn?: Fn;
}>;
const defaultFn: Fn = () => async () => null;

export type Prompting = Readonly<{
  init: Prompt.Prompt;
  prompt(trajectory: Trajectory): Effect.Effect<Option.Option<Prompt.Prompt>, PromptError>;
}>;

export class Service extends Context.Service<Service, Prompting>()("PromptingService") {}

export const make = ({ init, fn = defaultFn }: Options) =>
  Effect.fn(function* (context: Context) {
    const respFn = yield* Effect.tryPromise({
      try: async () => await fn(context),
      catch: PromptError.generation,
    });

    const prompt = (trajectory: Trajectory) =>
      Effect.tryPromise({
        try: () => respFn(trajectory),
        catch: PromptError.generation,
      })
        .pipe(Effect.map(Option.fromNullOr))
        .pipe(Effect.map(Option.map(Prompt.make)));

    return { init: Prompt.make(init), prompt } satisfies Prompting;
  });

export const layerFrom = (options: Options) => (context: Context) =>
  make(options)(context).pipe(Layer.effect(Service));
