import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import { Sandbox } from "@open-insight/core";
import { assert, it } from "@effect/vitest";
import { Config, Effect, Stream } from "effect";
import { Prompt } from "effect/unstable/ai";
import { makeOpenAi, type OpenAiConfig } from "#/provider/openai.ts";

const envPath = new URL("../../../.env", import.meta.url);

if (process.env.RUN_OPENAI_E2E === "1") {
  process.loadEnvFile(envPath);
}

const config: OpenAiConfig = {
  apiKey: Config.string("OPENAI_API_KEY"),
  baseUrl: Config.string("OPENAI_BASE_URL"),
  dotenvPath: envPath.pathname,
  model: process.env.OPENAI_MODEL ?? "deepseek-v4-flash",
};

const makeSandbox = (files: Map<string, string>, calls: Array<string>): Sandbox.Sandbox => ({
  spawn: (command) =>
    Effect.sync(() => {
      calls.push("Execute");
      return {
        exitCode: ExitCode(0),
        stdout: command.args?.join(" ") ?? "",
        stderr: "",
      };
    }),
  exitCode: () => Effect.succeed(ExitCode(0)),
  success: () => Effect.void,
  stdout: () => Effect.succeed(""),
  stderr: () => Effect.succeed(""),
  cmd: () => Effect.die("unused test sandbox method"),
  readFile: ({ sandboxPath }) =>
    Effect.sync(() => {
      calls.push("ReadFile");
      return files.get(sandboxPath) ?? "";
    }),
  writeFile: ({ sandboxPath, content }) =>
    Effect.sync(() => {
      calls.push("WriteFile");
      files.set(sandboxPath, content);
    }),
  download: () => Effect.die("unused test sandbox method"),
  upload: () => Effect.die("unused test sandbox method"),
  expose: () => Effect.die("unused test sandbox method"),
});

it.live.runIf(process.env.RUN_OPENAI_E2E === "1")(
  "runs an OpenAI Responses agent through every sandbox tool",
  () =>
    Effect.gen(function* () {
      const provider = yield* makeOpenAi(config);
      const files = new Map<string, string>();
      const calls: Array<string> = [];
      const agent = yield* provider.runSession(makeSandbox(files, calls));
      const parts = yield* agent
        .prompt(
          Prompt.make(
            "You are running an end-to-end test. You MUST call each sandbox tool at least once, in this order: " +
              "Execute, WriteFile, ReadFile. Use Execute with command printf and argument " +
              "OPENAI_E2E_EXECUTE_OK. Use WriteFile to write exactly OPENAI_E2E_FILE_OK to " +
              "/workspace/openai-e2e.txt. Use ReadFile to read that same path. After all three " +
              "tool calls succeed, reply with exactly OPENAI_E2E_OK and nothing else.",
          ),
        )
        .pipe(Stream.runCollect);
      const text = Array.from(parts)
        .filter((part) => part.type === "text-delta")
        .map((part) => part.delta)
        .join("");

      assert.deepStrictEqual(calls, ["Execute", "WriteFile", "ReadFile"]);
      assert.strictEqual(files.get("/workspace/openai-e2e.txt"), "OPENAI_E2E_FILE_OK");
      assert.include(text, "OPENAI_E2E_OK");
    }),
  60_000,
);
