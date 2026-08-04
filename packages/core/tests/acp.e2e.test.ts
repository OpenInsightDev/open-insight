/**
 * End-to-end tests for the ACP provider against the locally built latest
 * `packages/acp-agent` image, running `codex-acp` with the repository `.env`
 * credentials and the `deepseek-v4-flash` model.
 *
 * Build and start the agent first. The latest acp-agent disables Deno's
 * minimum dependency age for npm agents, while the client performs ACP
 * `agent/authenticate` explicitly. `CODEX_CONFIG` is still required because
 * the Codex CLI does not use `OPENAI_BASE_URL` by itself.
 *
 * ```sh
 * docker build --pull -t open-insight/acp-agent:local packages/acp-agent
 * docker run --rm -d --name open-insight-acp-e2e \
 *   --env-file .env \
 *   -e 'CODEX_CONFIG={"model":"deepseek-v4-flash","model_provider":"deepseek","model_providers":{"deepseek":{"name":"deepseek","base_url":"https://api.deepseek.com/v1","env_key":"OPENAI_API_KEY","wire_api":"responses"}}}' \
 *   -p 127.0.0.1:8010:8010 \
 *   open-insight/acp-agent:local \
 *   serve codex-acp --host 0.0.0.0 --port 8010 --yolo -- --model deepseek-v4-flash
 * ```
 *
 * These files live outside `src/` on purpose: they require a live agent
 * process and are excluded from the default `vp test` suite
 * (`test.include: ["src/**\/*.test.ts"]`). Run them explicitly:
 *
 * ```sh
 * cd packages/core
 * ./node_modules/.bin/vitest run --config e2e/vitest.e2e.config.ts
 * ```
 *
 * Both tests enter through `Acp.layer()`: the URL scheme selects Streamable
 * HTTP (JSON POST + SSE) or WebSocket, and initialization is followed by ACP
 * authentication before session creation.
 */
import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Prompt } from "effect/unstable/ai";
import * as Agent from "#/agent/index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import { layer } from "#/acp/index.ts";

const HTTP_URL = process.env["ACP_E2E_HTTP_URL"] ?? "http://127.0.0.1:8010/acp";
const WS_URL = process.env["ACP_E2E_WS_URL"] ?? "ws://127.0.0.1:8010/acp";
const AGENT_ID = process.env["ACP_E2E_AGENT"] ?? "codex-acp";
const AUTH_METHOD = process.env["ACP_E2E_AUTH_METHOD"] ?? "api-key";
const CWD = process.env["ACP_E2E_CWD"] ?? "/workspace";
const TEST_TIMEOUT = 180_000;

const unusedSandboxOperation = () =>
  Effect.die(new globalThis.Error("The ACP provider does not use the local sandbox handle"));

const sandbox = {
  spawn: unusedSandboxOperation,
  exitCode: unusedSandboxOperation,
  success: unusedSandboxOperation,
  stdout: unusedSandboxOperation,
  stderr: unusedSandboxOperation,
  cmd: unusedSandboxOperation,
  readFile: unusedSandboxOperation,
  writeFile: unusedSandboxOperation,
  download: unusedSandboxOperation,
  upload: unusedSandboxOperation,
  expose: unusedSandboxOperation,
} satisfies Sandbox.Sandbox;

const partText = (parts: ReadonlyArray<{ type: string; delta?: string }>): string =>
  parts
    .filter((part): part is { type: "text-delta"; delta: string } => part.type === "text-delta")
    .map((part) => part.delta)
    .join("");

const providerLayer = (url: string) =>
  layer(url, AGENT_ID, {
    auth: { methodId: AUTH_METHOD },
    cwd: CWD,
  });

it.layer(providerLayer(HTTP_URL), { timeout: TEST_TIMEOUT })("Streamable HTTP", (it) => {
  it.effect(
    "runs a real multi-turn codex-acp session",
    () =>
      Effect.gen(function* () {
        const provider = yield* Agent.ProviderService;

        const session = yield* provider.runSession(sandbox);

        // First turn: a real model completion over the wire.
        const firstParts = yield* session
          .prompt(Prompt.make("Reply with the single word: hello"))
          .pipe(Stream.runCollect);
        const firstText = partText(firstParts);
        assert.include(
          firstParts.map((part) => part.type),
          "finish",
          `first turn must finish, got parts: ${firstParts.map((part) => part.type).join(", ")}`,
        );
        assert.isAtLeast(firstText.length, 1, "first turn must produce assistant text");
        assert.match(firstText.toLowerCase(), /hello/);

        // The completed turn is committed to the session trajectory.
        const trajectory = yield* session.trajectory;
        assert.isAtLeast(trajectory.content.length, 2, "trajectory keeps user + assistant turns");
        assert.include(JSON.stringify(trajectory), "hello");

        // Second turn reuses the same ACP session and accumulates history.
        const secondParts = yield* session
          .prompt(Prompt.make("What was the word you just replied with?"))
          .pipe(Stream.runCollect);
        const secondText = partText(secondParts);
        assert.isAtLeast(secondText.length, 1, "second turn must produce assistant text");
        assert.match(secondText.toLowerCase(), /hello/);

        const finalTrajectory = yield* session.trajectory;
        assert.isAtLeast(finalTrajectory.content.length, 4, "history accumulates across turns");
      }),
    TEST_TIMEOUT,
  );
});

it.layer(providerLayer(WS_URL), { timeout: TEST_TIMEOUT })("WebSocket", (it) => {
  it.effect(
    "runs a real codex-acp session",
    () =>
      Effect.gen(function* () {
        const provider = yield* Agent.ProviderService;
        const session = yield* provider.runSession(sandbox);
        const parts = yield* session
          .prompt(Prompt.make("Reply with the single word: websocket"))
          .pipe(Stream.runCollect);
        const text = partText(parts);
        assert.include(
          parts.map((part) => part.type),
          "finish",
        );
        assert.match(text.toLowerCase(), /websocket/);
      }),
    TEST_TIMEOUT,
  );
});
