import { Effect, type Scope } from "effect";
import type { Error } from "../error.ts";
import type { EventStream } from "../queue.ts";

export type Transport = Readonly<{
  send(stream: EventStream): Effect.Effect<void, Error, Scope.Scope>;
}>;
