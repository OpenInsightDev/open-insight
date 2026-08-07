import { assert, layer } from "@effect/vitest";
import { Brand, Effect, Layer, Option } from "effect";
import * as Agent from "#/agent/index.ts";
import * as Harness from "./index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";

const snapshot = Brand.nominal<Snapshot.Snapshot>()({ name: "test-image" });

const sandboxProvider = {
  acquireSnapshot: () => Effect.succeed(snapshot),
  deriveSnapshot: () => Effect.succeed(snapshot),
  runSandbox: () => Effect.die("not used"),
} satisfies Sandbox.Provider;

const agentProvider = {
  snapshotExtension: Option.none(),
  runSession: () => Effect.die("not used"),
} satisfies Agent.Provider;

const dependencies = Layer.mergeAll(
  Layer.succeed(Sandbox.ProviderService)(sandboxProvider),
  Layer.succeed(Agent.ProviderService)(agentProvider),
);

layer(Harness.Service.layer("test").pipe(Layer.provide(dependencies)))((it) => {
  it.effect("builds a snapshot run backed by the acquired snapshot handle", () =>
    Effect.gen(function* () {
      const harness = yield* Harness.Service;
      const run = yield* harness.runSnapshot(Snapshot.makeTemplate("test-image"));
      assert.strictEqual(run.snapshot, snapshot);
    }).pipe(Effect.scoped),
  );
});
