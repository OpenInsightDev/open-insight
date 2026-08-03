import { NodeServices } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import * as Prompt from "./index.ts";

layer(NodeServices.layer)((it) => {
  it.effect("loads an Eta template and creates a user message", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const filePath = yield* fs.makeTempFile({ suffix: ".eta" });
        yield* fs.writeFileString(filePath, "Hello, <%= it.name %>!");

        const message = yield* Prompt.fromEta(filePath, { name: "Ada" });

        assert.strictEqual(message.role, "user");
        assert.lengthOf(message.content, 1);
        const part = message.content[0];
        assert.strictEqual(part?.type, "text");
        if (part?.type === "text") {
          assert.strictEqual(part.text, "Hello, Ada!");
        }
      }),
    ),
  );

  it.effect("uses an empty data object when no template data is supplied", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const filePath = yield* fs.makeTempFile({ suffix: ".eta" });
        yield* fs.writeFileString(filePath, "No data required");

        const message = yield* Prompt.fromEta(filePath);

        assert.strictEqual(
          message.content[0]?.type === "text" && message.content[0].text,
          "No data required",
        );
      }),
    ),
  );
});
