import { assert, it } from "@effect/vitest";
import * as Sandbox from "#/sandbox/index.ts";
import { Effect, Stream } from "effect";
import { Prompt } from "effect/unstable/ai";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import { make } from "./index.ts";

it.effect("calls every default sandbox tool and emits text", () =>
  Effect.gen(function* () {
    const calls: Array<string> = [];
    const sandbox: Sandbox.Sandbox = {
      spawn: () => {
        calls.push("execute");
        return Effect.succeed({ exitCode: ExitCode(0), stdout: "done", stderr: "" });
      },
      exitCode: () => Effect.succeed(ExitCode(0)),
      success: () => Effect.void,
      stdout: () => Effect.succeed(""),
      stderr: () => Effect.succeed(""),
      cmd: () => Effect.die("unused test sandbox method"),
      readFile: () => {
        calls.push("read");
        return Effect.succeed("localhost");
      },
      writeFile: () => {
        calls.push("write");
        return Effect.void;
      },
      download: () => Effect.die("unused test sandbox method"),
      upload: () => Effect.die("unused test sandbox method"),
      expose: () => Effect.die("unused test sandbox method"),
    };

    const provider = yield* make();
    const agent = yield* provider.runSession(sandbox);
    const parts = yield* agent.prompt(Prompt.make("run the dummy agent")).pipe(Stream.runCollect);
    const text = Array.from(parts)
      .filter((part) => part.type === "text-delta")
      .map((part) => part.delta)
      .join("");
    const lastToolCall = Array.from(parts).findLastIndex((part) => part.type === "tool-call");
    const textStart = Array.from(parts).findIndex((part) => part.type === "text-start");
    const trajectory = yield* agent.trajectory();

    assert.deepStrictEqual(calls.toSorted(), ["execute", "read", "write"]);
    assert.isTrue(lastToolCall < textStart);
    assert.match(text, /^[0-9a-f]{32}$/);
    assert.include(JSON.stringify(trajectory), text);
  }),
);
