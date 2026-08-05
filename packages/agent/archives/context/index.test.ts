import { assert, it, layer as testLayer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Prompt } from "effect/unstable/ai";
import { apply, resolve, Service } from "./index.ts";

it.effect("appends closed parts to their prompt message role", () =>
  Effect.gen(function* () {
    const text = Prompt.textPart({ text: "answer" });
    const call = Prompt.toolCallPart({
      id: "call",
      name: "Read",
      params: {},
      providerExecuted: false,
    });
    const result = Prompt.toolResultPart({
      id: "call",
      name: "Read",
      isFailure: false,
      result: "done",
    });

    const withText = yield* apply([], Prompt.make("question"), text);
    const withCall = yield* apply([], withText, call);
    const withResult = yield* apply([], withCall, result);

    assert.deepStrictEqual(
      withResult.content.map((message) => message.role),
      ["user", "assistant", "tool"],
    );
    assert.strictEqual(
      withResult.content[1]?.role === "assistant" && withResult.content[1].content.length,
      2,
    );
  }),
);

class First extends Service<First>()("test/Context/First") {}
class Second extends Service<Second>()("test/Context/Second") {}

const calls: Array<string> = [];
const services = Layer.merge(
  Layer.succeed(First)(
    First.of((handler) =>
      Effect.sync(() => {
        calls.push("first:before");
      }).pipe(
        Effect.andThen(handler),
        Effect.tap(() =>
          Effect.sync(() => {
            calls.push("first:after");
          }),
        ),
      ),
    ),
  ),
  Layer.succeed(Second)(
    Second.of((handler) =>
      Effect.sync(() => {
        calls.push("second:before");
      }).pipe(
        Effect.andThen(handler),
        Effect.tap(() =>
          Effect.sync(() => {
            calls.push("second:after");
          }),
        ),
      ),
    ),
  ),
);

testLayer(services)("ContextService", (it) => {
  it.effect("resolves Effect services and wraps the handler in declaration order", () =>
    Effect.gen(function* () {
      calls.length = 0;
      const middleware = yield* resolve([First, Second]);

      yield* apply(middleware, Prompt.empty, Prompt.textPart({ text: "answer" }));

      assert.deepStrictEqual(calls, [
        "second:before",
        "first:before",
        "first:after",
        "second:after",
      ]);
    }),
  );
});
