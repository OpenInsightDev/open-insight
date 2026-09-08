import { Cause, Effect, Option, Queue, PlatformError, Terminal } from "effect";
import type * as Scope from "effect/Scope";

import type { PtyCreateOptions, PtyHandle } from "@daytona/sdk";
import type { Process } from "@daytona/sdk";
import { Sandbox } from "@open-insight/core";

export type TerminalOptions = Omit<PtyCreateOptions, "id"> & {
  readonly id?: string;
};

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const toUserInput = (data: Uint8Array): Terminal.UserInput => {
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
  queue: Queue.Queue<Terminal.UserInput, Cause.Done>,
  options: TerminalOptions = {},
): Effect.fn.Return<PtyHandle, never, Scope.Scope> {
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
    }).pipe(Effect.orDie),
    (pty) =>
      Effect.promise(() => pty.disconnect()).pipe(
        Effect.andThen(Queue.shutdown(queue)),
        Effect.orDie,
      ),
  );

  yield* Effect.tryPromise({
    try: () => handle.waitForConnection(),
    catch: (cause) => cause,
  }).pipe(Effect.orDie);

  return handle;
});

export const makeTerminal = Effect.fn(function* (
  process: Process,
  options: TerminalOptions = {},
): Effect.fn.Return<Terminal.Terminal, never, Scope.Scope> {
  const queue = yield* Queue.unbounded<Terminal.UserInput, Cause.Done>();
  const handle = yield* makePty(process, queue, options);
  const columns = options.cols ?? 80;
  const rows = options.rows ?? 24;

  const readInput: Terminal.Terminal["readInput"] = Effect.succeed(queue);

  const readLine: Terminal.Terminal["readLine"] = Effect.gen(function* () {
    const parts: Array<string> = [];
    while (true) {
      const input = yield* Queue.take(queue).pipe(
        Effect.catchCause(() => Effect.fail(new Terminal.QuitError())),
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
      }).pipe(
        Effect.mapError((cause) =>
          PlatformError.systemError({
            _tag: "Unknown",
            module: "DaytonaTerminal",
            method: "display",
            cause,
          }),
        ),
        Effect.asVoid,
      ),
  });
});

export const make = makeTerminal;
