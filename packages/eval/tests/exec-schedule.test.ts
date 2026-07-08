import { Benchmark, Exec } from "#/index.ts";
import { EventTransportService } from "#/exec/event/index.ts";
import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Layer, Option } from "effect";
import { Agent, Sandbox } from "@open-insight/core/internal";
import { assert, it } from "@effect/vitest";

const harnessLayer = Layer.mergeAll(
  Layer.succeed(Agent.ProviderService)({
    snapshotExtension: Option.none(),
    runSession: () => Effect.never,
  }),
  Layer.succeed(Sandbox.ProviderService)({
    aquireSnapshot: () => Effect.never,
    deriveSnapshot: () => Effect.never,
    runSandbox: () => Effect.never,
  }),
);

it("propagates event transport failures without waiting for the schedule", async () => {
  const transportError = Exec.Error.eventTransport("test")(new Error("transport unavailable"));

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const benchmark = yield* Benchmark.make({
        name: "transport-failure",
        tasks: [Effect.never],
      });

      return yield* Exec.Schedule.run(
        {
          trailCount: 1,
          metrics: Option.none(),
          benchmark,
        },
        {},
      );
    }).pipe(
      Effect.provide(harnessLayer),
      Effect.provide(NodeServices.layer),
      Effect.provideService(EventTransportService, {
        send: () => Effect.fail(transportError),
      }),
      Effect.timeout("1 second"),
      Effect.exit,
    ),
  );

  assert.strictEqual(exit._tag, "Failure");
  if (exit._tag === "Success") {
    return;
  }

  const failure = exit.cause.reasons.find(Cause.isFailReason);
  assert.isDefined(failure);
  if (failure === undefined) {
    return;
  }
  assert.deepStrictEqual(failure.error, transportError);
});
