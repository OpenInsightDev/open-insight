import type { Contravariant } from "../utils/variant.ts";
import { Agent, Sandbox } from "@open-insight/core/internal";
import { type Brand, Effect, Layer } from "effect";
import { HarnessError } from "./error.ts";
import type * as Task from "../task/index.ts";

export type Harness<T extends Task.Task = Task.Task> = Readonly<{
  sandbox: Layer.Layer<Sandbox.ProviderService, HarnessError>;
  agent: Layer.Layer<Agent.ProviderService, HarnessError>;
}> & { _T?: T };

type Builder<T extends Task.Task = Task.Task, H = never, R = never> = Effect.Effect<
  Partial<Harness<T>>,
  HarnessError,
  R
> & { _typestate?: Contravariant<H>; _task?: T };

export const init = <T extends Task.Task = Task.Task>(): Builder<T> => Effect.succeed({});

type HasSandboxProvider = Brand.Brand<"HasSandboxProvider">;
export const withSandboxProvider =
  <R>(provider: Effect.Effect<Sandbox.Provider, Sandbox.SandboxError, R>) =>
  <T extends Task.Task, H, BR>(
    builder: Builder<T, H, BR>,
  ): Builder<T, H | HasSandboxProvider, R | BR> =>
    Effect.gen(function* () {
      const p = yield* provider.pipe(Effect.mapError(HarnessError.init));
      const layer = Layer.effect(Sandbox.ProviderService, Effect.succeed(p));
      const harness = yield* builder;
      return { ...harness, sandbox: layer };
    });

type HasAgentProvider = Brand.Brand<"HasAgentProvider">;
export const withAgentProvider =
  <E, R>(provider: Effect.Effect<Agent.Provider, E, R>) =>
  <T extends Task.Task, H, BR>(
    builder: Builder<T, H, BR>,
  ): Builder<T, H | HasAgentProvider, R | BR> =>
    Effect.gen(function* () {
      const p = yield* provider.pipe(Effect.mapError(HarnessError.init));
      const layer = Layer.effect(Agent.ProviderService, Effect.succeed(p));
      const harness = yield* builder;
      return { ...harness, agent: layer };
    });

export const build = <T extends Task.Task, R>(
  build: Builder<T, HasSandboxProvider | HasAgentProvider, R>,
): Effect.Effect<Harness<T>, HarnessError, R> =>
  build as Effect.Effect<Harness<T>, HarnessError, R>;
