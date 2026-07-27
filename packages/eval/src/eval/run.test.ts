import { assert, it } from "@effect/vitest";
import { Agent, Sandbox } from "@open-insight/core/internal";
import { Effect, Layer, Option, Ref, Stream } from "effect";
import * as Bench from "#/bench/index.ts";
import * as Event from "#/event/index.ts";
import * as Harness from "#/harness/index.ts";
import type * as Task from "#/task/index.ts";
import { run } from "./run.ts";

const makeOptions = Effect.fn(function* () {
  const tasks: ReadonlyArray<Task.Task> = [];
  const bench = yield* Bench.make({ id: "test-bench", tasks });
  const agent = {
    snapshotExtension: Option.none(),
    runSession: () => Effect.die("unused test agent provider"),
  } satisfies Agent.Provider;
  const sandbox = {
    aquireSnapshot: () => Effect.die("unused test sandbox provider"),
    deriveSnapshot: () => Effect.die("unused test sandbox provider"),
    runSandbox: () => Effect.die("unused test sandbox provider"),
  } satisfies Sandbox.Provider;
  const harness = {
    metadata: Harness.BaseMetadata.make({ id: "test-harness" }),
    layer: Layer.merge(
      Layer.succeed(Agent.ProviderService, agent),
      Layer.succeed(Sandbox.ProviderService, sandbox),
    ),
  } satisfies Harness.Harness;

  return { bench, harness };
});

it.effect("runs without an event transport", () =>
  makeOptions().pipe(Effect.flatMap((options) => run(options))),
);

it.effect("publishes events when an event transport is provided", () =>
  Effect.gen(function* () {
    const options = yield* makeOptions();
    const sends = yield* Ref.make(0);
    const transport = {
      send: (stream: Event.EventStream) =>
        Ref.update(sends, (count) => count + 1).pipe(Effect.andThen(Stream.runDrain(stream))),
    } satisfies Event.EventTransport;

    yield* run(options).pipe(Effect.provideService(Event.EventTransportService, transport));

    assert.strictEqual(yield* Ref.get(sends), 1);
  }),
);
