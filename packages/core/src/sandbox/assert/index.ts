import { Effect } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { Bash, Spawn } from "@/utils/index.ts";
import { AssertionFailure, Error } from "../error.ts";
import type { Sandbox } from "../sandbox/index.ts";
import { type Assert, Assertion, AssertSchema } from "./schema.ts";
import semver from "semver";

export type AssertOptions = Readonly<{
  concurrency?: "unbounded" | number;
}>;

type ExitFailure = Readonly<{
  exitCode: number | undefined;
  stderr: string | undefined;
}>;

const defaultOptions = {
  concurrency: "unbounded",
} satisfies Required<AssertOptions>;

const shell = (command: string) => CP.make("sh", ["-c", command]);

const commandValue = (command: CP.StandardCommand) =>
  [command.command, ...command.args].map(Bash.quote).join(" ");

const findExitFailure = (cause: unknown): ExitFailure | undefined => {
  if (cause instanceof Spawn.SpawnError && cause.reason._tag === "SpawnExitCodeError") {
    return {
      exitCode: cause.reason.exitCode,
      stderr: cause.reason.stderr,
    };
  }

  return undefined;
};

const fromCommandFailure = ({
  assertion,
  cause,
  message,
}: {
  assertion: Assertion;
  cause: Error;
  message: string;
}) => {
  const failure =
    cause.reason._tag === "SandboxExecError" ? findExitFailure(cause.reason.cause) : undefined;

  return AssertionFailure.make({
    assertion,
    message,
    expected: "exit code 0",
    actual:
      failure?.exitCode === undefined
        ? "command failed"
        : `exit code ${failure.exitCode}, stderr: ${failure.stderr ?? "<no stderr>"}`,
  });
};

const runString = (sandbox: Sandbox, command: string, assertion: Assertion) =>
  sandbox.$(shell(command)).pipe(
    Effect.mapError((cause) =>
      fromCommandFailure({
        assertion,
        cause,
        message: `Expected command to exit with code 0: ${command}`,
      }),
    ),
  );

export const success = (command: string): Assertion =>
  Assertion.make({
    _tag: "Success",
    command,
  });

export const equal = (command: string, expected: string): Assertion =>
  Assertion.make({
    _tag: "Equal",
    command,
    expected,
  });

export const program = (programName: string): Assertion =>
  Assertion.make({
    _tag: "Program",
    program: programName,
  });

export const env = (name: string, value?: string): Assertion =>
  Assertion.make({
    _tag: "Env",
    name,
    value,
  });

export const exists = (path: string): Assertion =>
  Assertion.make({
    _tag: "Exists",
    path,
  });

export const make = (...assertions: Array<Assertion>): Assert => AssertSchema.make(assertions);

export const check = Effect.fn(function* (
  sandbox: Sandbox,
  assertion: Assertion,
): Effect.fn.Return<void, AssertionFailure> {
  switch (assertion._tag) {
    case "Success": {
      yield* runString(sandbox, assertion.command, assertion);
      return;
    }
    case "Equal": {
      const actual = yield* runString(sandbox, assertion.command, assertion);
      if (actual !== assertion.expected) {
        return yield* Effect.fail(
          AssertionFailure.make({
            assertion,
            expected: assertion.expected,
            actual,
            message: `Expected command output to equal ${JSON.stringify(assertion.expected)}, got ${JSON.stringify(actual)}`,
          }),
        );
      }
      return;
    }
    case "Program": {
      const command = `command -v ${Bash.quote(assertion.program)}`;
      yield* runString(sandbox, command, assertion).pipe(
        Effect.mapError((error) =>
          AssertionFailure.make({
            ...error,
            message: `Expected program to be available: ${assertion.program}`,
          }),
        ),
      );
      return;
    }
    case "Version": {
      const versionCommand = `command -v ${Bash.quote(assertion.command)}`;
      const versionOutput = yield* runString(sandbox, versionCommand, assertion).pipe(
        Effect.mapError((error) =>
          AssertionFailure.make({
            ...error,
            message: `Expected command to be available: ${assertion.command}`,
          }),
        ),
      );

      if (!semver.valid(assertion.range)) {
        return yield* Effect.fail(
          AssertionFailure.make({
            assertion,
            expected: assertion.range,
            actual: versionOutput,
            message: `Expected range to be a valid semver string, got ${JSON.stringify(assertion.range)}`,
          }),
        );
      }

      if (!semver.satisfies(versionOutput, assertion.range)) {
        return yield* Effect.fail(
          AssertionFailure.make({
            assertion,
            expected: assertion.range,
            actual: versionOutput,
            message: `Expected command output to satisfy ${JSON.stringify(assertion.range)}, got ${JSON.stringify(versionOutput)}`,
          }),
        );
      }
      return;
    }
    case "Env": {
      const command = `printenv ${Bash.quote(assertion.name)}`;
      const actual = yield* runString(sandbox, command, assertion).pipe(
        Effect.mapError((error) =>
          AssertionFailure.make({
            ...error,
            message: `Expected environment variable to exist: ${assertion.name}`,
          }),
        ),
      );

      if (assertion.value !== undefined && actual !== assertion.value) {
        return yield* Effect.fail(
          AssertionFailure.make({
            assertion,
            expected: assertion.value,
            actual,
            message: `Expected environment variable ${assertion.name} to equal ${JSON.stringify(assertion.value)}, got ${JSON.stringify(actual)}`,
          }),
        );
      }
      return;
    }
    case "Exists": {
      const command = `test -e ${Bash.quote(assertion.path)}`;
      yield* runString(sandbox, command, assertion).pipe(
        Effect.mapError((error) =>
          AssertionFailure.make({
            ...error,
            message: `Expected path to exist: ${assertion.path}`,
          }),
        ),
      );
      return;
    }
  }
});

export const assert = Effect.fn(function* (
  sandbox: Sandbox,
  assertions: Iterable<Assertion>,
  options: AssertOptions = defaultOptions,
): Effect.fn.Return<void, Error> {
  yield* Effect.validate(assertions, (assertion) => check(sandbox, assertion), {
    concurrency: options.concurrency ?? defaultOptions.concurrency,
    discard: true,
  }).pipe(Effect.mapError(Error.assert));
});

export const command = (strings: TemplateStringsArray, ...values: Array<string>): Assertion =>
  success(commandValue(CP.make(strings, ...values)));

export const equals =
  (expected: string) =>
  (strings: TemplateStringsArray, ...values: Array<string>): Assertion =>
    equal(commandValue(CP.make(strings, ...values)), expected);

export * from "./schema.ts";
