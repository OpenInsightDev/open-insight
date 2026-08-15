import { assert, layer } from "@effect/vitest";
import { Brand, Effect, Layer, Option } from "effect";
import * as Agent from "#/agent/index.ts";
import * as Harness from "./index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";

const snapshot = Brand.nominal<Snapshot.Snapshot>()({ name: "test-image" });

const makeSandboxProvider = (onAcquire: () => void = () => {}) =>
  ({
    acquireSnapshot: () =>
      Effect.sync(() => {
        onAcquire();
        return snapshot;
      }),
    deriveSnapshot: () => Effect.succeed(snapshot),
    runSandbox: () => Effect.die("not used"),
  }) satisfies Sandbox.Provider;

const makeAgentProvider = () =>
  ({
    snapshotExtension: Option.none(),
    runSession: () => Effect.die("not used"),
  }) satisfies Agent.Provider;

const dependencies = Layer.mergeAll(
  Layer.succeed(Sandbox.ProviderService)(makeSandboxProvider()),
  Layer.succeed(Agent.ProviderService)(makeAgentProvider()),
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

let acquireCount = 0;
const countingDependencies = Layer.mergeAll(
  Layer.succeed(Sandbox.ProviderService)(makeSandboxProvider(() => void (acquireCount += 1))),
  Layer.succeed(Agent.ProviderService)(makeAgentProvider()),
);

layer(Harness.Service.layer("cached").pipe(Layer.provide(countingDependencies)))((it) => {
  it.effect("reuses the cached snapshot session for equivalent templates", () =>
    Effect.gen(function* () {
      const harness = yield* Harness.Service;
      const run1 = yield* harness.runSnapshot(Snapshot.makeTemplate("test-image"));
      const run2 = yield* harness.runSnapshot(Snapshot.makeTemplate("test-image"));
      assert.strictEqual(acquireCount, 1);
      assert.strictEqual(run1.snapshot, run2.snapshot);
    }).pipe(Effect.scoped),
  );

  it.effect("acquires a separate snapshot session per template", () =>
    Effect.gen(function* () {
      const harness = yield* Harness.Service;
      const before = acquireCount;
      yield* harness.runSnapshot(Snapshot.makeTemplate("image-a"));
      yield* harness.runSnapshot(Snapshot.makeTemplate("image-b"));
      assert.strictEqual(acquireCount, before + 2);
    }).pipe(Effect.scoped),
  );
});
