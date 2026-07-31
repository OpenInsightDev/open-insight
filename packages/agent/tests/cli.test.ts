import { Sandbox } from "@open-insight/core";
import { Spawn } from "@open-insight/core/utils";
import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import { Cli } from "#/index.ts";

const makeSandbox = (spawn: Sandbox.Sandbox["spawn"]): Sandbox.Sandbox => ({
  spawn,
  exitCode: () => Effect.die("unused test sandbox method"),
  success: () => Effect.die("unused test sandbox method"),
  stdout: () => Effect.die("unused test sandbox method"),
  stderr: () => Effect.die("unused test sandbox method"),
  cmd: () => Effect.die("unused test sandbox method"),
  readFile: () => Effect.die("unused test sandbox method"),
  writeFile: () => Effect.die("unused test sandbox method"),
  download: () => Effect.die("unused test sandbox method"),
  upload: () => Effect.die("unused test sandbox method"),
  expose: () => Effect.die("unused test sandbox method"),
});

const result = (stdout: string, stderr = "") => ({
  exitCode: ExitCode(0),
  stdout,
  stderr,
});

it("normalizes a string CLI spec into options with default args", () => {
  const options = Cli.from("git");

  assert.instanceOf(options, Cli.CliOptions);
  assert.strictEqual(options.command, "git");
  assert.deepStrictEqual(options.helpArgs, ["--help"]);
  assert.deepStrictEqual(options.runArgs, []);
});

it("keeps explicit options from an object CLI spec", () => {
  const options = Cli.from({ command: "gh", helpArgs: ["-h"], runArgs: ["repo", "view"] });

  assert.strictEqual(options.command, "gh");
  assert.deepStrictEqual(options.helpArgs, ["-h"]);
  assert.deepStrictEqual(options.runArgs, ["repo", "view"]);
});

it("decodes CLI options from external configuration", () => {
  const options = Schema.decodeUnknownSync(Cli.CliOptions)({
    command: "gh",
    helpArgs: ["help", "repo"],
  });

  assert.strictEqual(options.command, "gh");
  assert.deepStrictEqual(options.helpArgs, ["help", "repo"]);
});

it.effect("fetches help with the configured help args, capturing stderr", () =>
  Effect.gen(function* () {
    const calls: Array<Sandbox.Spawn.Command> = [];
    const sandbox = makeSandbox((command) =>
      Effect.sync(() => {
        calls.push(command);
        return result("", "usage on stderr");
      }),
    );

    const page = yield* Cli.fetchHelp(Cli.from({ command: "tool", helpArgs: ["-h"] }), sandbox);

    assert.deepStrictEqual(calls, [{ command: "tool", args: ["-h"] }]);
    assert.strictEqual(page.command, "tool");
    assert.strictEqual(page.help, "usage on stderr");
  }),
);

it.effect("runs all CLI help pages in parallel and joins them into instructions", () =>
  Effect.gen(function* () {
    let active = 0;
    let maxActive = 0;
    const sandbox = makeSandbox(({ command }) =>
      Effect.sync(() => {
        active += 1;
        maxActive = Math.max(maxActive, active);
      }).pipe(
        Effect.flatMap(() => Effect.yieldNow),
        Effect.map(() => {
          active -= 1;
          return result(`${command} help`);
        }),
      ),
    );

    const instructions = yield* Cli.instructions(
      ["git", { command: "gh", runArgs: ["repo", "view"] }],
      sandbox,
    );

    assert.strictEqual(maxActive, 2);
    assert.include(instructions, "CLI: git");
    assert.include(instructions, "Usage: git [arguments...]");
    assert.include(instructions, "git help");
    assert.include(instructions, "CLI: gh");
    assert.include(instructions, "Usage: gh repo view [arguments...]");
    assert.include(instructions, "gh help");
  }),
);

it.effect("returns no instructions for an empty CLI list", () =>
  Effect.gen(function* () {
    const sandbox = makeSandbox(() => Effect.die("unused test sandbox method"));

    const instructions = yield* Cli.instructions([], sandbox);

    assert.isUndefined(instructions);
  }),
);

it.effect("fails with a typed help error when a CLI cannot spawn", () =>
  Effect.gen(function* () {
    const sandbox = makeSandbox(() => Effect.fail(Spawn.Error.exit(ExitCode(1), "", "")));

    const error = yield* Cli.instructions(["missing"], sandbox).pipe(Effect.flip);

    assert.instanceOf(error, Cli.Error);
    assert.instanceOf(error.reason, Cli.HelpError);
    assert.strictEqual(error.reason.command, "missing");
    assert.strictEqual(error.reason.operation, "help");
    assert.include(error.message, 'Failed to run help for CLI "missing"');
    assert.strictEqual(error.cause, error.reason);
  }),
);
