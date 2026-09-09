import { Cause, Effect, Option, Queue } from "effect";
import type * as Scope from "effect/Scope";

import type { PtyCreateOptions, PtyHandle } from "@daytona/sdk";
import type { Process } from "@daytona/sdk";
import { Sandbox, SandboxError } from "@open-insight/core";

export type TerminalOptions = Omit<PtyCreateOptions, "id"> & {
  readonly id?: string;
};

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const toUserInput = (data: Uint8Array): Sandbox.UserInput => {
  const input = decoder.decode(data);
  return {
    input: Option.some(input),
    key: {
      name: input,
      ctrl: false,
      meta: false,
      shift: false,
    },
  };
};

const makePty = Effect.fn(function* (
  process: Process,
  queue: Queue.Queue<Sandbox.UserInput, Cause.Done>,
  options: TerminalOptions = {},
): Effect.fn.Return<PtyHandle, SandboxError, Scope.Scope> {
  const handle = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        process.createPty({
          ...options,
          id: options.id ?? `open-insight-${crypto.randomUUID()}`,
          onData: (data) =>
            Effect.runPromise(Queue.offer(queue, toUserInput(data))).then(() => undefined),
        }),
      catch: (cause) => cause,
    }).pipe(Effect.mapError(SandboxError.terminal("create"))),
    (pty) =>
      Effect.tryPromise({
        try: () => pty.disconnect(),
        catch: (cause) => cause,
      }).pipe(Effect.andThen(Queue.shutdown(queue)), Effect.ignore),
  );

  yield* Effect.tryPromise({
    try: () => handle.waitForConnection(),
    catch: (cause) => cause,
  }).pipe(Effect.mapError(SandboxError.terminal("waitForConnection")));

  return handle;
});

export const makeTerminal = Effect.fn(function* (
  process: Process,
  options: TerminalOptions = {},
): Effect.fn.Return<Sandbox.TerminalService, SandboxError, Scope.Scope> {
  const queue = yield* Queue.unbounded<Sandbox.UserInput, Cause.Done>();
  const handle = yield* makePty(process, queue, options);
  const columns = options.cols ?? 80;
  const rows = options.rows ?? 24;

  const readInput: Sandbox.TerminalService["readInput"] = Effect.succeed(queue);

  const readLine: Sandbox.TerminalService["readLine"] = Effect.gen(function* () {
    const parts: Array<string> = [];
    while (true) {
      const input = yield* Queue.take(queue).pipe(
        Effect.catchCause(() => Effect.fail(new Sandbox.Terminal.QuitError())),
      );
      const value = Option.getOrElse(input.input, () => "");
      parts.push(value);
      if (value.includes("\n")) {
        return parts.join("").replace(/\r?\n[\s\S]*$/, "");
      }
    }
  });

  return Sandbox.Terminal.make({
    columns: Effect.succeed(columns),
    rows: Effect.succeed(rows),
    readInput,
    readLine,
    display: (text) =>
      Effect.tryPromise({
        try: () => handle.sendInput(encoder.encode(text)),
        catch: (cause) => cause,
      }).pipe(Effect.mapError(SandboxError.terminal("display")), Effect.asVoid),
  });
});

export const make = makeTerminal;
