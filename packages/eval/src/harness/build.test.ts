import { assert, it } from "@effect/vitest";
import { Agent, Sandbox } from "@open-insight/core/internal";
import { Effect, Option } from "effect";
import { make, metadata } from "./build.ts";

const agent: Agent.Provider = {
  snapshotExtension: Option.none(),
  runSession: () => Effect.die("agent provider should not be used by harness build test"),
};

const sandbox: Sandbox.Provider = {
  aquireSnapshot: () => Effect.die("sandbox provider should not be used by harness build test"),
  deriveSnapshot: () => Effect.die("sandbox provider should not be used by harness build test"),
  runSandbox: () => Effect.die("sandbox provider should not be used by harness build test"),
};

it.effect("builds base metadata and exports full metadata", () =>
  Effect.gen(function* () {
    const harness = yield* make({ id: "test-harness", extras: { provider: "test" } }).pipe(
      Effect.provideService(Agent.ProviderService, agent),
      Effect.provideService(Sandbox.ProviderService, sandbox),
    );

    assert.strictEqual(harness.metadata.id, "test-harness");
    assert.deepStrictEqual(harness.metadata.extras, { provider: "test" });
    assert.deepStrictEqual(metadata(harness).base, harness.metadata);
  }),
);
