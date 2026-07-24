import { assert, describe, it } from "@effect/vitest";
import { DeliveryFailed, Error, InvalidEvent } from "./error.ts";

describe("event errors", () => {
  it("classifies events that cannot be published", () => {
    const cause = new globalThis.Error("invalid event");
    const error = Error.invalid(cause);

    assert.strictEqual(error._tag, "EventError");
    assert.instanceOf(error.reason, InvalidEvent);
    assert.strictEqual(error.reason.cause, cause);
  });

  it("classifies events that cannot be delivered", () => {
    const cause = new globalThis.Error("delivery failed");
    const error = Error.delivery(cause);

    assert.strictEqual(error._tag, "EventError");
    assert.instanceOf(error.reason, DeliveryFailed);
    assert.strictEqual(error.reason.cause, cause);
  });

  it("preserves an event error when it crosses another event boundary", () => {
    const error = Error.invalid(new globalThis.Error("invalid event"));

    assert.strictEqual(Error.delivery(error), error);
  });
});
