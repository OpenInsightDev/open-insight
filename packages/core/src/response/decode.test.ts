import { assert, it } from "@effect/vitest";
import { Effect, Schema, Stream } from "effect";
import { Response, Tool, Toolkit } from "effect/unstable/ai";
import { decodeStreamPartView } from "./decode.ts";

const OldTool = Tool.make("old", {
  parameters: Schema.Struct({ value: Schema.Number }),
  success: Schema.String,
});

const NewTool = Tool.make("new", {
  parameters: Schema.Struct({ value: Schema.NumberFromString }),
  success: Schema.String,
});

const oldToolkit = Toolkit.make(OldTool);
const newToolkit = Toolkit.make(NewTool);

it.effect("decodes new tools while preserving existing decoded tools", () =>
  Effect.gen(function* () {
    const oldPart = Response.toolCallPart({
      id: "old-call",
      name: "old",
      params: { value: 1 },
      providerExecuted: false,
    });
    const newPart = Response.anyToolCallPart({
      id: "new-call",
      name: "new",
      params: { value: "2" },
      providerExecuted: false,
    });
    const filePart = Response.makePart("file", {
      mediaType: "text/plain",
      data: new Uint8Array([1, 2, 3]),
    });
    const stream: Stream.Stream<Response.StreamPartView<Toolkit.Tools<typeof oldToolkit>>> =
      Stream.fromIterable([oldPart, newPart, filePart]);

    const parts = yield* stream.pipe(
      Stream.mapEffect((part) => decodeStreamPartView(newToolkit)(part)),
      Stream.runCollect,
    );
    const [decodedOld, decodedNew, decodedFile] = Array.from(parts);

    assert.strictEqual(decodedOld, oldPart);
    assert.strictEqual(decodedNew?.type, "tool-call");
    if (decodedNew?.type === "tool-call") {
      assert.deepStrictEqual(decodedNew.params, { value: 2 });
      assert.isFalse(Response.isAnyToolCallPart(decodedNew));
    }
    assert.strictEqual(decodedFile, filePart);
  }),
);
