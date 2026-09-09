import type { SandboxError } from "@open-insight/core";
import { Cause, Context, Effect, Queue, Scope } from "effect";
import type { QuitError, UserInput } from "effect/Terminal";

export class Terminal extends Context.Service<
  Terminal,
  {
    readonly columns: Effect.Effect<number>;
    readonly rows: Effect.Effect<number>;
    readonly readInput: Effect.Effect<Queue.Dequeue<UserInput, Cause.Done>, never, Scope.Scope>;
    readonly readLine: Effect.Effect<string, QuitError>;
    readonly display: (text: string) => Effect.Effect<void, SandboxError>;
  }
>()("open-insight/sandbox/Terminal") {}
