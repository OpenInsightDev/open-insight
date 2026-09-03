import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Schema, Stream } from "effect";
import { Response, Tool, Toolkit } from "effect/unstable/ai";
import { TrajectoryError } from "./error.ts";
import { toolCalls, toolTurns } from "./tool.ts";
import { type Trajectory, type Part } from "./trajectory.ts";

const Convert = Tool.make("convert", {
  parameters: Schema.Struct({ value: Schema.Number }),
  success: Schema.String,
});
const toolkit = Toolkit.make(Convert);
type Tools = Toolkit.Tools<typeof toolkit>;

const timestamp = DateTime.makeUnsafe("2024-01-01T00:00:00.000Z");
const uuid = "01890f47-3d90-7cc3-98c8-683a927d7851";
const response = (part: Response.PartView<Tools>): Part<Tools> => ({
  _tag: "Response",
  timestamp,
  uuid,
  response: part,
});
const decodeResponse = Schema.decodeUnknownSync(Response.PartView(toolkit));
const call = (id: string, name: string, value = 1): Part<Tools> =>
  response(
    decodeResponse({
      type: "tool-call",
      id,
      name,
      params: { value },
      providerExecuted: false,
    }),
  );
const result = (id: string, name: string, preliminary = false): Part<Tools> =>
  response(
    decodeResponse({
      type: "tool-result",
      id,
      name,
      result: "done",
      isFailure: false,
      providerExecuted: false,
      preliminary,
    }),
  );
const trajectory = (...parts: ReadonlyArray<Part<Tools>>): Trajectory<Tools> =>
  Object.assign(Stream.fromIterable(parts), { toolkit }) as Trajectory<Tools>;
const collect = <A, E>(stream: Stream.Stream<A, E>) =>
  stream.pipe(
    Stream.runCollect,
    Effect.map((items) => Array.from(items)),
  );

describe("tool trajectory views", () => {
  it.effect("pairs known calls with their final results", () =>
    Effect.gen(function* () {
      const source = trajectory(call("call-1", "convert"), result("call-1", "convert"));
      const turns = yield* collect(toolTurns(source));

      assert.strictEqual(turns.length, 1);
      assert.strictEqual(turns[0]?.call.id, "call-1");
      assert.strictEqual(turns[0]?.result.id, "call-1");
    }),
  );

  it.effect("supports interleaved calls and matches results by id", () =>
    Effect.gen(function* () {
      const source = trajectory(
        call("call-1", "convert"),
        call("call-2", "convert"),
        result("call-2", "convert"),
        result("call-1", "convert"),
      );
      const turns = yield* collect(toolTurns(source));

      assert.deepStrictEqual(
        turns.map((turn) => turn.call.id),
        ["call-2", "call-1"],
      );
    }),
  );

  it.effect("ignores preliminary results while retaining the pending call", () =>
    Effect.gen(function* () {
      const source = trajectory(
        call("call-1", "convert"),
        result("call-1", "convert", true),
        result("call-1", "convert"),
      );
      const turns = yield* collect(toolTurns(source));

      assert.strictEqual(turns.length, 1);
      assert.isFalse(turns[0]?.result.preliminary ?? true);
    }),
  );

  it.effect("ignores unknown tools, orphan results, and mismatched names", () =>
    Effect.gen(function* () {
      const source = trajectory(
        call("unknown-call", "unknown"),
        result("unknown-call", "unknown"),
        result("orphan", "convert"),
        call("call-1", "convert"),
        result("call-1", "other"),
        result("call-1", "convert"),
      );
      const turns = yield* collect(toolTurns(source));

      assert.strictEqual(turns.length, 1);
      assert.strictEqual(turns[0]?.call.id, "call-1");
    }),
  );

  it.effect("replaces a pending call when an id is reused", () =>
    Effect.gen(function* () {
      const first = call("call-1", "convert");
      const second = call("call-1", "convert", 2);
      const turns = yield* collect(
        toolTurns(trajectory(first, second, result("call-1", "convert"))),
      );

      assert.strictEqual(turns.length, 1);
      assert.deepStrictEqual(turns[0]?.call.params, { value: 2 });
    }),
  );

  it.effect("toolCalls emits calls that have a matching final result", () =>
    Effect.gen(function* () {
      const source = trajectory(
        call("completed", "convert"),
        call("pending", "convert"),
        result("completed", "convert"),
      );
      const calls = yield* collect(toolCalls(source));

      assert.deepStrictEqual(
        calls.map((part) => part.id),
        ["completed"],
      );
    }),
  );

  it.effect("preserves trajectory failures", () =>
    Effect.gen(function* () {
      const failure = TrajectoryError.storage("offline");
      const source = Object.assign(Stream.fail(failure), { toolkit }) as Trajectory<Tools>;

      const turnsError = yield* collect(toolTurns(source)).pipe(Effect.flip);
      const callsError = yield* collect(toolCalls(source)).pipe(Effect.flip);
      assert.strictEqual(turnsError, failure);
      assert.strictEqual(callsError, failure);
    }),
  );
});
