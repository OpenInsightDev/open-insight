import { assert, it } from "@effect/vitest";
import { ChildProcess } from "effect/process";
import * as Shell from "#/Shell.ts";

it("quotes shell arguments so they survive a shell", () => {
  assert.strictEqual(Shell.quote("plain"), "'plain'");
  assert.strictEqual(Shell.quote("two words"), "'two words'");
  assert.strictEqual(Shell.quote("it's"), `'it'\\''s'`);
});

it("formats commands as a shell pipeline", () => {
  assert.strictEqual(
    Shell.format(ChildProcess.make("echo", ["hello world"])),
    "'echo' 'hello world'",
  );

  const pipeline = ChildProcess.make("echo", ["error"]).pipe(
    ChildProcess.pipeTo(ChildProcess.make("grep", ["error"]), { from: "stderr" }),
  );

  assert.strictEqual(Shell.format(pipeline), "'echo' 'error' | 'grep' 'error'");
});

const script = (
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<Shell.TemplateExpression>
): string => Shell.makeScript(strings, values);

it("interpolates script values with shell quoting", () => {
  const path = "a b";

  assert.strictEqual(script`cat ${path}`, "cat 'a b'");
  assert.strictEqual(script`ls ${["one", "two words"]}`, "ls 'one' 'two words'");
});
