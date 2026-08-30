import { Option } from "effect";
import type { Signature } from "./analyzer.ts";

/**
 * A value keyed by trajectory id, as produced by {@link Analyzer.runAll}.
 */
export type Reports<A> = Readonly<{ [id: string]: A }>;

/**
 * The trajectory that produced an extreme value.
 */
export type Extreme = Readonly<{ id: string; value: number }>;

/**
 * Distribution of one metric across a cohort of trajectories.
 */
export type Summary = Readonly<{
  count: number;
  total: number;
  mean: number;
  median: number;
  /** Population standard deviation, i.e. how much the cohort disagrees. */
  stddev: number;
  min: Extreme;
  max: Extreme;
}>;

const quantile = (sorted: ReadonlyArray<number>, fraction: number): number => {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

/**
 * Summarizes one numeric metric across trajectories, or `None` for an empty
 * cohort.
 *
 * A single trajectory tells you what happened once; a summary tells you whether
 * it was typical. The gap between `min`, `median` and `max` is the run-to-run
 * variance that a regression has to beat to be real, and both extremes name the
 * trajectory to open next.
 *
 * @example
 * ```ts
 * const reports = yield* Analyzer.runAll(trials, Analyzer.usage);
 * const spend = Compare.summarize(Record.map(reports, (usage) => usage.outputTokens));
 * // Some({ mean: 8_140, median: 6_200, max: { id: "trial-3", value: 31_002 }, ... })
 * ```
 */
export const summarize = (values: Reports<number>): Option.Option<Summary> => {
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return Option.none();
  }

  const numbers = entries.map(([, value]) => value);
  const total = numbers.reduce((sum, value) => sum + value, 0);
  const mean = total / numbers.length;
  const variance = numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length;
  const ranked = [...entries].sort(([, left], [, right]) => left - right);
  const [minId, minValue] = ranked[0];
  const [maxId, maxValue] = ranked[ranked.length - 1];

  return Option.some({
    count: numbers.length,
    total,
    mean,
    median: quantile(
      [...numbers].sort((left, right) => left - right),
      0.5,
    ),
    stddev: Math.sqrt(variance),
    min: { id: minId, value: minValue },
    max: { id: maxId, value: maxValue },
  });
};

/**
 * The point at which two trajectories stopped doing the same thing.
 */
export type Divergence = Readonly<{
  /** Number of leading steps the two trajectories share. */
  shared: number;
  /** What the left trajectory did instead, absent if it had already finished. */
  left: Option.Option<string>;
  /** What the right trajectory did instead, absent if it had already finished. */
  right: Option.Option<string>;
}>;

/**
 * Locates the first step where two trajectories parted ways, or `None` when they
 * behaved identically.
 *
 * This is the tool for questions about change: two runs of the same task at
 * temperature 0 that diverge prove the pipeline is not deterministic, and a run
 * before and after a prompt or scaffold change shows exactly which action the
 * change moved rather than only whether the score moved.
 *
 * @example
 * ```ts
 * const point = Compare.divergence(reports.before.signature, reports.after.signature);
 * // Some({ shared: 9, left: Some("tool:read_file"), right: Some("tool:grep") })
 * // -> the new system prompt changed behaviour at step 9, not at the answer.
 * ```
 */
export const divergence = (left: Signature, right: Signature): Option.Option<Divergence> => {
  const shorter = Math.min(left.length, right.length);
  let shared = 0;
  while (shared < shorter && left[shared] === right[shared]) {
    shared = shared + 1;
  }

  if (shared === left.length && shared === right.length) {
    return Option.none();
  }

  return Option.some({
    shared,
    left: Option.fromUndefinedOr(left[shared]),
    right: Option.fromUndefinedOr(right[shared]),
  });
};

/**
 * How differently two trajectories behaved, as a number between `0` (same
 * labels in the same order) and `1` (nothing in common).
 *
 * This is a length-normalized edit distance over labels, so trajectories of
 * different lengths stay comparable. Averaged over a cohort of identically
 * configured runs it gives the noise floor any claimed behavioural change has to
 * exceed; between cohorts it says whether two agents work the same way.
 *
 * @example
 * ```ts
 * const noise = Compare.summarize(Compare.pairwise(baseline, Compare.distance));
 * const effect = Compare.distance(baseline["trial-1"], candidate["trial-1"]);
 * // effect below noise.value.max -> the change is indistinguishable from luck.
 * ```
 */
export const distance = (left: Signature, right: Signature): number => {
  const longest = Math.max(left.length, right.length);
  if (longest === 0) {
    return 0;
  }

  // Levenshtein over two rows: trajectories get long, the matrix does not.
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row = row + 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column = column + 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }

  return previous[right.length] / longest;
};

/**
 * Applies a comparison to every unordered pair of a cohort, keyed by the pair.
 *
 * @example
 * ```ts
 * // How consistent is this agent with itself?
 * const spread = Compare.summarize(Compare.pairwise(signatures, Compare.distance));
 * ```
 */
export const pairwise = <A, B>(
  values: Reports<A>,
  compare: (left: A, right: A) => B,
): Reports<B> => {
  const entries = Object.entries(values);
  const pairs: Array<readonly [string, B]> = [];

  for (let left = 0; left < entries.length; left = left + 1) {
    for (let right = left + 1; right < entries.length; right = right + 1) {
      pairs.push([
        `${entries[left][0]} vs ${entries[right][0]}`,
        compare(entries[left][1], entries[right][1]),
      ]);
    }
  }

  return Object.fromEntries(pairs);
};

/**
 * Rewrites a signature as its overlapping label windows, so comparisons see
 * short action patterns instead of single actions.
 *
 * @example
 * ```ts
 * Compare.ngrams(["tool:edit", "tool:test", "tool:edit", "tool:test"], 2);
 * // ["tool:edit > tool:test", "tool:test > tool:edit", "tool:edit > tool:test"]
 * ```
 */
export const ngrams = (signature: Signature, size: number): Signature =>
  size <= 0 || signature.length < size
    ? []
    : Array.from({ length: signature.length - size + 1 }, (_, index) =>
        signature.slice(index, index + size).join(" > "),
      );

/**
 * How much more common a label is in one group of trajectories than in another.
 */
export type Contrast = Readonly<{
  label: string;
  /** Fraction of the left group that contains the label. */
  left: number;
  /** Fraction of the right group that contains the label. */
  right: number;
  /** `left - right`: positive means specific to the left group. */
  delta: number;
}>;

const prevalence = (group: ReadonlyArray<Signature>): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const signature of group) {
    for (const label of new Set(signature)) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return counts;
};

/**
 * Ranks labels by how much they distinguish two groups of trajectories, sorted
 * from most left-specific to most right-specific.
 *
 * Split a cohort by outcome and this answers the question a score cannot: what
 * did the failures actually do differently? Combine it with {@link ngrams} to
 * contrast patterns (`tool:edit > tool:test`) instead of single actions.
 *
 * @example
 * ```ts
 * const failed = ids.failed.map((id) => reports[id].signature);
 * const passed = ids.passed.map((id) => reports[id].signature);
 * Compare.contrast(failed, passed);
 * // [{ label: "finish:length", left: 0.8, right: 0, delta: 0.8 }, ...]
 * // -> failures ran out of context, they did not pick the wrong tool.
 * ```
 */
export const contrast = (
  left: ReadonlyArray<Signature>,
  right: ReadonlyArray<Signature>,
): ReadonlyArray<Contrast> => {
  const leftCounts = prevalence(left);
  const rightCounts = prevalence(right);
  const labels = new Set([...leftCounts.keys(), ...rightCounts.keys()]);

  return Array.from(labels, (label): Contrast => {
    const leftShare = left.length === 0 ? 0 : (leftCounts.get(label) ?? 0) / left.length;
    const rightShare = right.length === 0 ? 0 : (rightCounts.get(label) ?? 0) / right.length;
    return { label, left: leftShare, right: rightShare, delta: leftShare - rightShare };
  }).sort((first, second) => second.delta - first.delta);
};
