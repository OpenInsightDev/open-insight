import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { IDSchema } from "./id.ts";

class Model extends Schema.Class<Model>("Model")({
  id: IDSchema,
}) {}

it.effect("generates and preserves ids across schema boundaries", () =>
  Effect.gen(function* () {
    const constructed = yield* Model.makeEffect({});
    const decoded = yield* Schema.decodeEffect(Model)({});
    const encoded = yield* Schema.encodeEffect(Model)(constructed);

    assert.match(
      constructed.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.match(
      decoded.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.deepStrictEqual(encoded, { id: constructed.id });
  }),
);
