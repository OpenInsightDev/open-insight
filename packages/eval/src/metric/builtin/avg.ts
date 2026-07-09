/** Returns the total of all values, or `0` for an empty input. */
export const sum = (values: ReadonlyArray<number>): number =>
  values.reduce((acc, val) => acc + val, 0);

/** Returns the number of items in the input. */
export const count = (values: ReadonlyArray<unknown>): number => values.length;

/** Returns the smallest value, or `0` for an empty input. */
export const min = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, val) => (val < acc ? val : acc), values[0] ?? 0);
};

/** Returns the largest value, or `0` for an empty input. */
export const max = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, val) => (val > acc ? val : acc), values[0] ?? 0);
};

/** Returns the arithmetic mean, or `0` for an empty input. */
export const mean = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) {
    return 0;
  }
  return sum(values) / values.length;
};

/** Returns the geometric mean, or `0` for an empty input. */
export const geoMean = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) {
    return 0;
  }
  const product = values.reduce((acc, val) => acc * val, 1);
  return Math.pow(product, 1 / values.length);
};

/** Returns the harmonic mean, or `0` for an empty input. */
export const harmonicMean = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) {
    return 0;
  }
  const denominator = values.reduce((acc, val) => acc + 1 / val, 0);
  return denominator === 0 ? 0 : values.length / denominator;
};

/** Returns the root mean square, or `0` for an empty input. */
export const rootMeanSquare = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) {
    return 0;
  }
  return Math.sqrt(mean(values.map((value) => value * value)));
};

/** Returns a curried percentile-style quantile using linear interpolation. */
export const quantile =
  (q: number) =>
  (values: ReadonlyArray<number>): number => {
    if (values.length === 0) {
      return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const clampedQ = Math.min(1, Math.max(0, q));
    const index = (sorted.length - 1) * clampedQ;
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.ceil(index);
    const lower = sorted[lowerIndex] ?? 0;
    const upper = sorted[upperIndex] ?? lower;

    return lower + (upper - lower) * (index - lowerIndex);
  };

/** Returns a curried percentile using linear interpolation. */
export const percentile =
  (p: number) =>
  (values: ReadonlyArray<number>): number =>
    quantile(p / 100)(values);

/** Returns the median using linear interpolation, or `0` for an empty input. */
export const median = quantile(0.5);

/** Returns the population variance, or `0` for an empty input. */
export const variance = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) {
    return 0;
  }
  const avg = mean(values);
  return mean(values.map((value) => (value - avg) ** 2));
};

/** Returns the unbiased sample variance, or `0` when fewer than two values exist. */
export const sampleVariance = (values: ReadonlyArray<number>): number => {
  if (values.length < 2) {
    return 0;
  }
  const avg = mean(values);
  return sum(values.map((value) => (value - avg) ** 2)) / (values.length - 1);
};

/** Returns the population standard deviation, or `0` for an empty input. */
export const stdDev = (values: ReadonlyArray<number>): number => Math.sqrt(variance(values));

/** Returns the sample standard deviation, or `0` when fewer than two values exist. */
export const sampleStdDev = (values: ReadonlyArray<number>): number =>
  Math.sqrt(sampleVariance(values));

/** Returns the standard error of the mean, or `0` for an empty input. */
export const standardError = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) {
    return 0;
  }
  return sampleStdDev(values) / Math.sqrt(values.length);
};
