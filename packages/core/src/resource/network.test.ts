import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Network from "./network.ts";

it.effect("accepts supported allowlist entry forms", () =>
  Effect.gen(function* () {
    const allowedHosts = [
      "example.com",
      "example.com.",
      "localhost",
      "*.example.com",
      "192.0.2.1",
      "192.0.2.0/24",
      "192.0.2.1/24",
      "2001:db8::1",
      "2001:db8::/32",
      "2001:db8::1/32",
      "café.example",
    ];

    const policy = yield* Schema.decodeUnknownEffect(Network.Policy)({
      mode: "allowlist",
      allowedHosts,
    });

    assert.deepStrictEqual(policy, Network.allowlist(allowedHosts));
  }),
);

it.effect("rejects invalid allowlist entries", () =>
  Effect.gen(function* () {
    const invalidHosts = [
      "https://example.com",
      "example.com:443",
      "example.com/path",
      "foo.*.example.com",
      "*.192.0.2.1",
      "999.0.0.1",
      "9999.0.0.1",
      "01.2.3.4",
      "192.0.2.0/33",
      "[2001:db8::1]",
    ];

    yield* Effect.forEach(
      invalidHosts,
      (host) =>
        Schema.decodeUnknownEffect(Network.Policy)({
          mode: "allowlist",
          allowedHosts: [host],
        }).pipe(Effect.flip),
      { discard: true },
    );
  }),
);

it.effect("does not allow hosts on public or no-network policies", () =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(Network.Policy)({
      mode: "public",
      allowedHosts: ["example.com"],
    }).pipe(Effect.flip);
    yield* Schema.decodeUnknownEffect(Network.Policy)({
      mode: "no-network",
      allowedHosts: ["example.com"],
    }).pipe(Effect.flip);
  }),
);
