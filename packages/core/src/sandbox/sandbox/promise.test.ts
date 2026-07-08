import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { Bash } from "../../utils/index.ts";
import type { Sandbox } from "./index.ts";
import { asPromise } from "./promise.ts";

const makeSandbox = (onCommand: (command: CP.Command) => void): Sandbox => ({
  cmd: (command) =>
    Effect.sync(() => {
      onCommand(command);
      return "ok";
    }),
  readFile: () => Effect.succeed(""),
  writeFile: () => Effect.void,
  download: () => Effect.void,
  upload: () => Effect.void,
  expose: () => Effect.succeed({ hostUrl: "http://localhost" }),
});

it.effect("runs template commands through sh -c with shell-escaped values", () =>
  Effect.gen(function* () {
    const expectedScript = `printf %s ${Bash.quote("hello 'world'")} ${["two words", "three"]
      .map(Bash.quote)
      .join(" ")}`;
    let captured: CP.Command | undefined;
    const sandbox = makeSandbox((command) => {
      captured = command;
    });

    const promiseSandbox = yield* asPromise(sandbox);
    yield* Effect.promise(
      () => promiseSandbox.$`printf %s ${"hello 'world'"} ${["two words", "three"]}`,
    );

    if (captured === undefined || !CP.isStandardCommand(captured)) {
      throw new globalThis.Error("expected a standard command");
    }

    assert.strictEqual(captured.command, "sh");
    assert.deepStrictEqual(captured.args, ["-c", expectedScript]);
  }),
);

it.effect("preserves command options while forcing sh -c for the options overload", () =>
  Effect.gen(function* () {
    let captured: CP.Command | undefined;
    const sandbox = makeSandbox((command) => {
      captured = command;
    });

    const promiseSandbox = yield* asPromise(sandbox);
    yield* Effect.promise(
      () =>
        promiseSandbox.$({
          cwd: "/tmp",
          env: { TEST_VALUE: "from-env" },
          shell: "/bin/bash",
        })`printenv TEST_VALUE`,
    );

    if (captured === undefined || !CP.isStandardCommand(captured)) {
      throw new globalThis.Error("expected a standard command");
    }

    assert.strictEqual(captured.command, "sh");
    assert.deepStrictEqual(captured.args, ["-c", "printenv TEST_VALUE"]);
    assert.strictEqual(captured.options.cwd, "/tmp");
    assert.deepStrictEqual(captured.options.env, { TEST_VALUE: "from-env" });
    assert.isUndefined(captured.options.shell);
  }),
);
