import { assert, it } from "@effect/vitest";
import { Effect, Schema, Stream } from "effect";
import { Prompt, Response, Tool, Toolkit } from "effect/unstable/ai";
import { make } from "./trajectory.ts";

const StoredTool = Tool.make("stored", {
  parameters: Schema.Struct({ value: Schema.NumberFromString }),
  success: Schema.String,
});

it.effect("decodes stored response parts with the configured toolkits", () => {
  const toolkit = Toolkit.make(StoredTool);
  const decoded = Response.toolCallPart({
    id: "call-1",
    name: "stored",
    params: { value: 42 },
    providerExecuted: false,
  });
  const encoded = Schema.encodeSync(Response.AllParts(toolkit))(decoded);
  const storage = {
    prompts: () => Stream.succeed(Prompt.empty),
    responses: () => Stream.succeed(encoded),
  };

  return Effect.gen(function* () {
    const trajectory = yield* make(storage, toolkit);
    const turns = yield* trajectory.turns().pipe(Stream.runCollect);
    const response = turns[0]?.response;

    assert.strictEqual(response?.type, "tool-call");
    if (response?.type === "tool-call") {
      assert.deepStrictEqual(response.params, { value: 42 });
    }
  });
});
