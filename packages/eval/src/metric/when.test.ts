import { assert, describe, it } from "@effect/vitest";
import { Prompt } from "@open-insight/core/internal";
import { Schedule as EffectSchedule } from "effect";
import * as When from "./when.ts";
import {
  always,
  bash,
  content,
  exists,
  fails,
  interval,
  message,
  success,
  toolCall,
  type Context,
} from "./when.ts";

type ShellOptions = Parameters<Context["$"]>[0];

const isTemplateStringsArray = (
  value: TemplateStringsArray | ShellOptions,
): value is TemplateStringsArray => Array.isArray(value);

const makeShell = (result: () => Promise<string>): Context["$"] => {
  function shell(strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>): Promise<string>;
  function shell(
    options: ShellOptions,
  ): (strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>) => Promise<string>;
  function shell(
    first: TemplateStringsArray | ShellOptions,
  ): Promise<string> | ((strings: TemplateStringsArray) => Promise<string>) {
    return isTemplateStringsArray(first) ? result() : result;
  }
  return shell;
};

const unused = (): Promise<never> => Promise.reject(new Error("unused sandbox operation"));

const makeContext = (shell: Context["$"]): Context => ({
  $: shell,
  cmd: unused,
  readFile: unused,
  download: unused,
  results: {},
  trajectory: Prompt.empty,
});

const text = (role: "system" | "user" | "assistant", value: string): Prompt.Message => {
  const parts = [Prompt.textPart({ text: value })];
  switch (role) {
    case "system":
      return Prompt.systemMessage({ content: value });
    case "user":
      return Prompt.userMessage({ content: parts });
    case "assistant":
      return Prompt.assistantMessage({ content: parts });
  }
};

const tool = (...names: ReadonlyArray<string>): Prompt.ToolMessage =>
  Prompt.toolMessage({
    content: names.map((name, index) =>
      Prompt.toolResultPart({
        id: `tool-${index}`,
        name,
        result: "done",
        isFailure: false,
      }),
    ),
  });

describe("constructors", () => {
  it("defaults both variants to the always exec predicate", async () => {
    const traj = When.traj();
    const scheduled = When.schedule(EffectSchedule.spaced("1 second"));

    assert.strictEqual(traj._tag, "Traj");
    assert.isTrue(traj._tag === "Traj" && traj.on(Prompt.empty));
    assert.isTrue(await traj.exec(makeContext(makeShell(() => Promise.resolve("")))));
    assert.strictEqual(scheduled._tag, "Schedule");
    assert.isTrue(await scheduled.exec(makeContext(makeShell(() => Promise.resolve("")))));
  });

  it("retains an explicit schedule retry and exec predicate", () => {
    const schedule = EffectSchedule.spaced("30 seconds");
    const retry = EffectSchedule.spaced("1 second");
    const exec = () => false;
    const when = When.schedule(schedule, { retry, exec });

    assert.strictEqual(when._tag, "Schedule");
    assert.isTrue(when._tag === "Schedule" && when.schedule === schedule);
    assert.isTrue(when._tag === "Schedule" && when.retry === retry);
    assert.strictEqual(when.exec, exec);
  });

  it("builds a fixed schedule with interval", () => {
    assert.strictEqual(interval("5 seconds")._tag, "Schedule");
  });
});

describe("trajectory conditions", () => {
  it("matches the last trajectory message role", () => {
    const trajectory = Prompt.make([text("user", "task"), text("assistant", "done")]);
    const assistant = message("assistant");
    const user = message("user");

    assert.isTrue(assistant._tag === "Traj" && assistant.on(trajectory));
    assert.isFalse(user._tag === "Traj" && user.on(trajectory));
    assert.isFalse(assistant._tag === "Traj" && assistant.on(Prompt.empty));
  });

  it("matches a result in only the latest completed tool message", () => {
    const trajectory = Prompt.make([
      tool("old-tool"),
      text("assistant", "continuing"),
      tool("read", "write"),
      text("assistant", "done"),
    ]);
    const anyTool = toolCall();
    const write = toolCall("write");
    const old = toolCall("old-tool");

    assert.isTrue(anyTool._tag === "Traj" && anyTool.on(trajectory));
    assert.isTrue(write._tag === "Traj" && write.on(trajectory));
    assert.isFalse(old._tag === "Traj" && old.on(trajectory));
  });

  it("does not match when there is no completed tool result", () => {
    const approval = Prompt.toolMessage({
      content: [Prompt.toolApprovalResponsePart({ approvalId: "approval-1", approved: true })],
    });
    const anyTool = toolCall();

    assert.isFalse(anyTool._tag === "Traj" && anyTool.on(Prompt.empty));
    assert.isFalse(anyTool._tag === "Traj" && anyTool.on(Prompt.make([approval])));
  });
});

describe("exec predicates", () => {
  it("always succeeds", () => {
    assert.isTrue(always());
  });

  it("checks command success and failure", async () => {
    const ok = makeContext(makeShell(() => Promise.resolve("output")));
    const failed = makeContext(makeShell(() => Promise.reject(new Error("failed"))));

    assert.isTrue(await success("test command")(ok));
    assert.isFalse(await success("test command")(failed));
    assert.isFalse(await fails("test command")(ok));
    assert.isTrue(await fails("test command")(failed));
  });

  it("checks trimmed command and file content", async () => {
    const context = makeContext(makeShell(() => Promise.resolve(" expected\n")));

    assert.isTrue(await bash({ bash: "command", expect: "expected" })(context));
    assert.isTrue(await content({ sandboxPath: "/result", expect: "expected" })(context));
  });

  it("checks file existence via command status", async () => {
    const present = makeContext(makeShell(() => Promise.resolve("")));
    const missing = makeContext(makeShell(() => Promise.reject(new Error("missing"))));

    assert.isTrue(await exists("/result")(present));
    assert.isFalse(await exists("/result")(missing));
  });
});
