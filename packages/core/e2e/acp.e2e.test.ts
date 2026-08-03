/**
 * End-to-end tests for the ACP provider against the published agent image
 * `ghcr.io/openinsightdev/acp-agent:0.0.2` running `codex-acp` with the
 * repository `.env` credentials and the `deepseek-v4-flash` model.
 *
 * Start the agent first (credentials are read from the repository `.env`). The
 * published image's `codex-acp` needs three extra pieces that a plain `docker
 * run` does not provide:
 *
 * 1. `deno.json` with `minimumDependencyAge: 0` mounted at `/workspace/deno.json`
 *    (the registry's fresh `@agentclientprotocol/codex-acp` release is blocked
 *    by Deno's default 24h dependency-age policy otherwise),
 * 2. `DEFAULT_AUTH_REQUEST` so the agent authenticates with the `api-key`
 *    method (this module never calls `agent/authenticate`),
 * 3. `CODEX_CONFIG` pointing the codex CLI at the DeepSeek-compatible base URL
 *    (the `OPENAI_BASE_URL` env var alone is ignored by the codex CLI).
 *
 * ```sh
 * printf '{\n  "minimumDependencyAge": 0\n}\n' > /tmp/acp-e2e/deno.json
 * docker run --rm -d --name acp-e2e \
 *   -e OPENAI_API_KEY="$(grep '^OPENAI_API_KEY=' .env | cut -d= -f2)" \
 *   -e OPENAI_BASE_URL="$(grep '^OPENAI_BASE_URL=' .env | cut -d= -f2)" \
 *   -e 'DEFAULT_AUTH_REQUEST={"methodId":"api-key"}' \
 *   -e 'CODEX_CONFIG={"model":"deepseek-v4-flash","model_provider":"deepseek","model_providers":{"deepseek":{"name":"deepseek","base_url":"https://api.deepseek.com/v1","env_key":"OPENAI_API_KEY","wire_api":"responses"}}}' \
 *   -v /tmp/acp-e2e/deno.json:/workspace/deno.json \
 *   -p 127.0.0.1:8010:8010 \
 *   ghcr.io/openinsightdev/acp-agent:0.0.2 \
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
 * The WebSocket transport (`createWebSocketStream`) is the wire path the
 * published 0.0.2 image exposes. The h2c `openHttpStream` transport in
 * `src/acp/http.ts` targets an unreleased `acp-agent serve --transport http`
 * mode; the last test pins the observable gap against the real image.
 */
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import { assert, it } from "@effect/vitest";
import { Effect, Path, Stream } from "effect";
import { Prompt } from "effect/unstable/ai";
import * as Sandbox from "#/sandbox/index.ts";
import { Error, makeProvider, openHttpStream } from "#/acp/index.ts";

const WS_URL = process.env["ACP_E2E_URL"] ?? "ws://127.0.0.1:8010/acp";
const HTTP_URL = process.env["ACP_E2E_HTTP_URL"] ?? "http://127.0.0.1:8010/acp";
const AGENT_ID = process.env["ACP_E2E_AGENT"] ?? "codex-acp";
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

it.effect(
  "runs a real codex-acp session over the published image's WebSocket transport",
  () =>
    Effect.gen(function* () {
      const provider = yield* makeProvider(createWebSocketStream(WS_URL), AGENT_ID, {
        cwd: CWD,
      }).pipe(Effect.provide(Path.layer));

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
      const trajectory = yield* session.trajectory();
      assert.isAtLeast(trajectory.content.length, 2, "trajectory keeps user + assistant turns");
      assert.include(JSON.stringify(trajectory), "hello");

      // Second turn reuses the same ACP session and accumulates history.
      const secondParts = yield* session
        .prompt(Prompt.make("What was the word you just replied with?"))
        .pipe(Stream.runCollect);
      const secondText = partText(secondParts);
      assert.isAtLeast(secondText.length, 1, "second turn must produce assistant text");
      assert.match(secondText.toLowerCase(), /hello/);

      const finalTrajectory = yield* session.trajectory();
      assert.isAtLeast(finalTrajectory.content.length, 4, "history accumulates across turns");
    }),
  TEST_TIMEOUT,
);

it.effect(
  "pins the h2c transport gap against the published 0.0.2 image (no --transport http mode)",
  () =>
    Effect.gen(function* () {
      const error = yield* Effect.scoped(openHttpStream(HTTP_URL)).pipe(Effect.flip);

      assert.instanceOf(error, Error);
      const reason = error.reason;
      assert.strictEqual(reason._tag, "AcpHttpTransportError");
      if (reason._tag !== "AcpHttpTransportError") {
        return;
      }
      assert.strictEqual(reason.operation, "response");
      assert.strictEqual(reason.status, 415);
      assert.include(reason.message, "expected HTTP status 200");
    }),
  TEST_TIMEOUT,
);
