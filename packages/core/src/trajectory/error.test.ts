import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { DecodeFailed, ErrorReason, StorageFailed, TrajectoryError } from "./error.ts";

const assertTrajectoryError = (
  error: TrajectoryError,
  reason: StorageFailed | DecodeFailed,
): void => {
  assert.strictEqual(error._tag, "TrajectoryError");
  assert.strictEqual(error.reason, reason);
  assert.strictEqual(error.cause, reason);
  assert.strictEqual(error.message, reason.message);
};

describe("trajectory errors", () => {
  it("constructs storage errors with the original cause", () => {
    const cause = new Error("disk unavailable");
    const error = TrajectoryError.storage(cause);

    assert.instanceOf(error.reason, StorageFailed);
    assert.strictEqual(error.reason._tag, "StorageFailed");
    assert.strictEqual(error.reason.cause, cause);
    assert.include(error.message, "Trajectory storage failed");
    assert.include(error.message, "disk unavailable");
    assertTrajectoryError(error, error.reason);
  });

  it("constructs decode errors with the original cause", () => {
    const cause = { input: "invalid" };
    const error = TrajectoryError.decode(cause);

    assert.instanceOf(error.reason, DecodeFailed);
    assert.strictEqual(error.reason._tag, "DecodeFailed");
    assert.strictEqual(error.reason.cause, cause);
    assert.include(error.message, "Trajectory response decoding failed");
    assert.include(error.message, "invalid");
    assertTrajectoryError(error, error.reason);
  });

  it.effect("ErrorReason accepts both reason variants and rejects unrelated values", () =>
    Effect.gen(function* () {
      const storage = StorageFailed.make({ cause: "storage" });
      const decode = DecodeFailed.make({ cause: "decode" });

      const decodedStorage = yield* Schema.decodeUnknownEffect(ErrorReason)(storage);
      const decodedDecode = yield* Schema.decodeUnknownEffect(ErrorReason)(decode);
      assert.instanceOf(decodedStorage, StorageFailed);
      assert.strictEqual(decodedStorage.cause, "storage");
      assert.instanceOf(decodedDecode, DecodeFailed);
      assert.strictEqual(decodedDecode.cause, "decode");
      yield* Schema.decodeUnknownEffect(ErrorReason)({ _tag: "Other", cause: "no" }).pipe(
        Effect.flip,
      );
    }),
  );

  it.effect("TrajectoryError round-trips through its schema", () =>
    Effect.gen(function* () {
      const original = TrajectoryError.storage("offline");
      const encoded = yield* Schema.encodeEffect(TrajectoryError)(original);
      const decoded = yield* Schema.decodeEffect(TrajectoryError)(encoded);

      assert.strictEqual(decoded._tag, "TrajectoryError");
      assert.instanceOf(decoded.reason, StorageFailed);
      assert.strictEqual(decoded.reason.cause, "offline");
      assert.strictEqual(decoded.message, original.message);
    }),
  );
});
