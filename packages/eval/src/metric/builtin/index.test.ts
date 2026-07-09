import { assert, describe, it } from "@effect/vitest";
import * as Metric from "./index.ts";

const assertCloseTo = (actual: number, expected: number, delta = 1e-12) => {
  assert.isAtMost(Math.abs(actual - expected), delta);
};

describe("metric builtin stats", () => {
  it("computes basic numeric aggregations", () => {
    const values = [1, 2, 3, 4];

    assert.strictEqual(Metric.count(values), 4);
    assert.strictEqual(Metric.sum(values), 10);
    assert.strictEqual(Metric.min(values), 1);
    assert.strictEqual(Metric.max(values), 4);
    assert.strictEqual(Metric.mean(values), 2.5);
    assertCloseTo(Metric.geoMean([1, 4, 16]), 4);
    assertCloseTo(Metric.harmonicMean([1, 2, 4]), 12 / 7);
    assertCloseTo(Metric.rootMeanSquare([3, 4]), Math.sqrt(12.5));
  });

  it("computes rank-based aggregations with curried helpers", () => {
    const values = [10, 20, 30, 40];

    assert.strictEqual(Metric.median(values), 25);
    assert.strictEqual(Metric.quantile(0)(values), 10);
    assert.strictEqual(Metric.quantile(0.25)(values), 17.5);
    assert.strictEqual(Metric.quantile(1)(values), 40);
    assert.strictEqual(Metric.percentile(75)(values), 32.5);
  });

  it("computes dispersion aggregations", () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9];

    assert.strictEqual(Metric.variance(values), 4);
    assertCloseTo(Metric.stdDev(values), 2);
    assertCloseTo(Metric.sampleVariance(values), 32 / 7);
    assertCloseTo(Metric.sampleStdDev(values), Math.sqrt(32 / 7));
    assertCloseTo(Metric.standardError(values), Math.sqrt(32 / 7) / Math.sqrt(values.length));
  });

  it("returns zero for empty inputs", () => {
    assert.strictEqual(Metric.count([]), 0);
    assert.strictEqual(Metric.sum([]), 0);
    assert.strictEqual(Metric.min([]), 0);
    assert.strictEqual(Metric.max([]), 0);
    assert.strictEqual(Metric.mean([]), 0);
    assert.strictEqual(Metric.geoMean([]), 0);
    assert.strictEqual(Metric.harmonicMean([]), 0);
    assert.strictEqual(Metric.rootMeanSquare([]), 0);
    assert.strictEqual(Metric.median([]), 0);
    assert.strictEqual(Metric.quantile(0.5)([]), 0);
    assert.strictEqual(Metric.percentile(50)([]), 0);
    assert.strictEqual(Metric.variance([]), 0);
    assert.strictEqual(Metric.sampleVariance([]), 0);
    assert.strictEqual(Metric.stdDev([]), 0);
    assert.strictEqual(Metric.sampleStdDev([]), 0);
    assert.strictEqual(Metric.standardError([]), 0);
  });
});
