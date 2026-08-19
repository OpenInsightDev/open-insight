import { assert, it } from "@effect/vitest";
import { Effect, Exit, Path, Schema } from "effect";
import { AbsPath } from "./service.ts";

const decode = (input: unknown) =>
  Schema.decodeUnknownEffect(AbsPath)(input).pipe(Effect.provide(Path.layer));

it.effect("accepts Unix absolute paths", () =>
  Effect.gen(function* () {
    const path = yield* decode("/var/lib/open-insight");
    assert.strictEqual(path, "/var/lib/open-insight");
  }),
);

it.effect("rejects paths that are not Unix absolute paths", () =>
  Effect.gen(function* () {
    const relative = yield* Effect.exit(decode("var/lib/open-insight"));
    const windows = yield* Effect.exit(decode("C:\\open-insight"));

    assert.isTrue(Exit.isFailure(relative));
    assert.isTrue(Exit.isFailure(windows));
  }),
);
