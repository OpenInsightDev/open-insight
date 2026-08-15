import { describe, expect, it } from "vite-plus/test";
import { Effect, Stream } from "effect";
import { make, makeStream, type TrailResult } from "../src/metric/task/index.ts";

describe("task metric stream", () => {
  it("threads accumulated results and the previous metric value", async () => {
    const first: TrailResult<number> = { grade: 2, sessions: [] };
    const second: TrailResult<number> = { grade: 3, sessions: [] };
    const calls: Array<readonly [number[], number, number | null]> = [];

    const program = Effect.gen(function* () {
      const metric = yield* make<number, number>({
        id: "total-grade",
        exec: (results, delta, prev) => {
          calls.push([results.map(({ grade }) => grade), delta.grade, prev]);
          return (prev ?? 0) + delta.grade;
        },
      });

      return yield* makeStream({ results: [first], delta: first })(metric).pipe(
        Stream.concat(makeStream({ results: [second], delta: second })(metric)),
        Stream.runCollect,
      );
    });

    const results = Array.from(await Effect.runPromise(program));

    expect(calls).toEqual([
      [[2], 2, null],
      [[3], 3, 2],
    ]);
    expect(results.map(({ id, value, chart }) => ({ id, value, chart }))).toEqual([
      { id: "total-grade", value: 2, chart: null },
      { id: "total-grade", value: 5, chart: null },
    ]);
  });
});
