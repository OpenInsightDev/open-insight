import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { Resource } from "../index.ts";

describe("Resource.make", () => {
  it("accepts a network mode as a plain string", () => {
    const resources = Resource.make({
      network: "no-network",
    });
    const network = Option.getOrThrow(resources.network);
    assert.strictEqual(network.mode, "no-network");
    assert.deepStrictEqual(network.allowedHosts, []);
  });

  it("accepts an allowlist network object", () => {
    const resources = Resource.make({
      network: { allowlist: ["example.com"] },
    });
    const network = Option.getOrThrow(resources.network);
    assert.strictEqual(network.mode, "allowlist");
    assert.deepStrictEqual(network.allowedHosts, ["example.com"]);
  });

  it("leaves network unset when omitted", () => {
    const resources = Resource.make();
    assert.isTrue(Option.isNone(resources.network));
  });
});
