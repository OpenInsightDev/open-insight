import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import type { Sandbox as SandboxService } from "@/sandbox/sandbox/index.ts";
import { Prompt } from "effect/unstable/ai";
import { make } from "./index.ts";

const emptySandbox: SandboxService = {
  $: () => Effect.succeed(""),
  readFile: () => Effect.succeed(""),
  writeFile: () => Effect.succeed(undefined),
  download: () => Effect.succeed(undefined),
  upload: () => Effect.succeed(undefined),
  expose: () => Effect.succeed({ hostUrl: "http://localhost" }),
};

it.effect("dummy agent accumulates history like a normal agent", () =>
  Effect.gen(function* () {
    const provider = yield* make({});
    const agent = yield* provider.runSession({ sandbox: emptySandbox });

    const first = yield* agent.prompt({
      prompt: [
        Prompt.makeMessage("user", {
          content: [Prompt.makePart("text", { text: "first" })],
        }),
      ],
    });
    const firstParts = yield* Stream.runCollect(first).pipe(
      Effect.map((chunk) => Array.from(chunk) as Array<{ type: string }>),
    );

    const second = yield* agent.prompt({
      prompt: [
        Prompt.makeMessage("user", {
          content: [Prompt.makePart("text", { text: "second" })],
        }),
      ],
    });
    const secondParts = yield* Stream.runCollect(second).pipe(
      Effect.map((chunk) => Array.from(chunk) as Array<{ type: string }>),
    );

    const trajectory = yield* agent.trajectory();

    assert.strictEqual(firstParts.at(-1)?.type, "finish");
    assert.strictEqual(secondParts.at(-1)?.type, "finish");
    assert.strictEqual(trajectory.content.length, 4);
    assert.strictEqual(trajectory.content[0]?.role, "user");
    assert.strictEqual(trajectory.content[1]?.role, "assistant");
    assert.strictEqual(trajectory.content[2]?.role, "user");
    assert.strictEqual(trajectory.content[3]?.role, "assistant");
  }),
);
