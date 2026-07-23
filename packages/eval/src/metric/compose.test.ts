import { assert, describe, expectTypeOf, it } from "vitest";
import { Line, Pie } from "#/chart/schema.ts";
import { make } from "./compose.ts";

const score = () => ({ score: 0.8 });

const latency = () => ({ milliseconds: 120 });

describe("compose metric chart", () => {
  it("maps metric names to their result types", () => {
    const compose = make({ score, latency })({
      chart: (input) => {
        expectTypeOf(input).toEqualTypeOf<{
          readonly score: { score: number };
          readonly latency: { milliseconds: number };
        }>();

        return [
          Line.make({ legend: "score", x: "result", y: input.score.score }),
          Line.make({ legend: "latency", x: "result", y: input.latency.milliseconds }),
        ];
      },
    });

    assert.strictEqual(compose.metrics.score, score);
    assert.strictEqual(compose.metrics.latency, latency);

    const points = compose.chart({
      score: { score: 0.9 },
      latency: { milliseconds: 100 },
    });
    assert.lengthOf(points, 2);
  });

  it("only accepts composable chart points", () => {
    make({ score })({
      // @ts-expect-error Pie is a standalone chart point.
      chart: ({ score }) => [Pie.make({ legend: "score", value: score.score })],
    });
  });

  it("only accepts metric definitions with JSON object results", () => {
    make({
      // @ts-expect-error Metric results must be JSON objects.
      invalid: () => 1,
    });
  });
});
