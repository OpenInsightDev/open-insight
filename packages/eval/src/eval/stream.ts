import { Effect, Ref } from "effect";
import { Response } from "effect/unstable/ai";
import { type Any } from "./eval.ts";
import * as Task from "#/task/index.ts";
import * as Event from "#/event/index.ts";
import type { Sandbox } from "@open-insight/core/internal";

type SessionOptions = Readonly<{
  id: Event.SessionID;
  task: Task.Any;
  sandbox: Sandbox.Sandbox;
}>;
const makeSession = Effect.fn(function* ({ id, task, sandbox }: SessionOptions) {
  const usageRef = yield* Ref.make<Response.Usage | null>(null);
  const finishRef = yield* Ref.make<Response.FinishReason>("unknown");
});

type TrailOptions = Readonly<{}>;
const makeTrail = Effect.fn(function* (options: TrailOptions) {});

type TaskOptions = Readonly<{}>;
const makeTask = Effect.fn(function* (options: TaskOptions) {});

type EvalOptions<Eval extends Any> = Readonly<{
  eval: Eval;
}>;
export const make = Effect.fn(function* <Eval extends Any>(options: EvalOptions<Eval>) {});
