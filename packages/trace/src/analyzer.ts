import { Data, Effect, Hash, Option, Stream, type Predicate, type Types } from "effect";
import type { Trajectory } from "@open-insight/core/internal";
import type { Tool } from "effect/unstable/ai";
import * as Step from "./step.ts";

/**
 * A description of how to fold a sequence of inputs into an analysis result.
 *
 * An analyzer is a value, not an effect: it can be built, named, combined and
 * reused, and only touches a trajectory when it is handed to {@link run}. Because
 * folds compose ({@link all}), any number of analyzers run in a single streaming
 * pass, which is what makes it cheap to ask many questions about a long
 * trajectory at once.
 *
 * The fold state is existential: it is an implementation detail of the analyzer
 * and never appears in the type of a report.
 */
export class Analyzer<in In, out A> extends Data.Class<{
  readonly initial: () => unknown;
  readonly step: (state: unknown, input: In) => unknown;
  readonly result: (state: unknown) => A;
}> {}
export type Any = Analyzer<any, any>;

/**
 * The result type produced by an analyzer.
 */
export type Result<T extends Any> = T extends Analyzer<any, infer A> ? A : never;

/**
 * The input type accepted by every analyzer of a record, i.e. the input a
 * combined analyzer requires.
 */
export type In<T extends Record<string, Any>> = {
  [K in keyof T]: (input: T[K] extends Analyzer<infer I, any> ? I : never) => void;
}[keyof T] extends (input: infer I) => void
  ? I
  : never;

/**
 * Builds an analyzer from a fold.
 *
 * @example
 * ```ts
 * // How much text did the agent write, in characters?
 * const verbosity = Analyzer.make({
 *   initial: () => 0,
 *   step: (total, step: Step.Text) => total + step.text.length,
 *   result: (total) => total,
 * }).pipe(Analyzer.filterInput(Step.isText));
 * ```
 */
export const make = <S, In, A>(options: {
  readonly initial: () => S;
  readonly step: (state: S, input: In) => S;
  readonly result: (state: S) => A;
}): Analyzer<In, A> =>
  new Analyzer({
    initial: options.initial,
    // The state type is existential, so it is erased here and restored by the
    // three functions always being applied to the state they created.
    step: options.step as (state: unknown, input: In) => unknown,
    result: options.result as (state: unknown) => A,
  });

/**
 * Builds an analyzer whose result is the fold state itself.
 */
export const reduce = <S, In>(
  initial: () => S,
  step: (state: S, input: In) => S,
): Analyzer<In, S> => make({ initial, step, result: (state) => state });

/**
 * Transforms the result of an analyzer.
 */
export const map =
  <A, B>(f: (result: A) => B) =>
  <In>(self: Analyzer<In, A>): Analyzer<In, B> =>
    new Analyzer({
      initial: self.initial,
      step: self.step,
      result: (state) => f(self.result(state)),
    });

/**
 * Derives the input of an analyzer, so an analyzer written against one shape can
 * be reused on another.
 */
export const mapInput =
  <In, In2>(f: (input: In2) => In) =>
  <A>(self: Analyzer<In, A>): Analyzer<In2, A> =>
    new Analyzer({
      initial: self.initial,
      step: (state, input: In2) => self.step(state, f(input)),
      result: self.result,
    });

/**
 * Restricts an analyzer to the inputs it cares about.
 *
 * @example
 * ```ts
 * // Where did the agent first go wrong?
 * const firstFailure = Analyzer.first<Step.ToolCall<any>>().pipe(
 *   Analyzer.filterInput(Step.isFailed),
 * );
 * ```
 */
export const filterInput: {
  <In, Out extends In>(
    refinement: Predicate.Refinement<In, Out>,
  ): <A>(self: Analyzer<Out, A>) => Analyzer<In, A>;
  <In>(predicate: Predicate.Predicate<In>): <A>(self: Analyzer<In, A>) => Analyzer<In, A>;
} =
  <In>(predicate: Predicate.Predicate<In>) =>
  <A>(self: Analyzer<In, A>): Analyzer<In, A> =>
    new Analyzer({
      initial: self.initial,
      step: (state, input: In) => (predicate(input) ? self.step(state, input) : state),
      result: self.result,
    });

/**
 * Combines analyzers into one that answers every question in a single pass.
 *
 * @example
 * ```ts
 * // One pass over the trajectory, one report.
 * const report = yield* Analyzer.run(
 *   trajectory,
 *   Analyzer.all({
 *     steps: Analyzer.count,
 *     usage: Analyzer.usage,
 *     tools: Analyzer.tools,
 *     repeated: Analyzer.repetitions,
 *   }),
 * );
 * ```
 */
export const all = <T extends Record<string, Any>>(
  analyzers: T,
): Analyzer<In<T>, { readonly [K in keyof T]: Result<T[K]> }> => {
  const entries = Object.entries(analyzers);

  return make({
    initial: () => Object.fromEntries(entries.map(([key, one]) => [key, one.initial()])),
    step: (states: Record<string, unknown>, input: In<T>) =>
      Object.fromEntries(entries.map(([key, one]) => [key, one.step(states[key], input)])),
    result: (states) =>
      Object.fromEntries(entries.map(([key, one]) => [key, one.result(states[key])])) as {
        readonly [K in keyof T]: Result<T[K]>;
      },
  });
};

/**
 * Counts the inputs.
 */
export const count: Analyzer<unknown, number> = reduce(
  () => 0,
  (total) => total + 1,
);

/**
 * Collects every input, in order.
 */
export const collect = <In>(): Analyzer<In, ReadonlyArray<In>> =>
  reduce(
    (): Array<In> => [],
    (collected, input) => {
      collected.push(input);
      return collected;
    },
  );

/**
 * Keeps the first input, if any.
 */
export const first = <In>(): Analyzer<In, Option.Option<In>> =>
  reduce(Option.none<In>, (kept, input) => (Option.isSome(kept) ? kept : Option.some(input)));

/**
 * Keeps the last input, if any.
 *
 * @example
 * ```ts
 * // Did the agent stop because it was done, or because it ran out of context?
 * const outcome = Analyzer.last<Step.Finish>().pipe(Analyzer.filterInput(Step.isFinish));
 * ```
 */
export const last = <In>(): Analyzer<In, Option.Option<In>> =>
  reduce(Option.none<In>, (_, input) => Option.some(input));

/**
 * The label sequence of a trajectory, i.e. what the agent did with the payloads
 * stripped away.
 *
 * Signatures are what the {@link Compare} facilities consume: they are small
 * enough to keep thousands of them in memory and comparable across runs, models
 * and toolkits.
 *
 * @example
 * ```ts
 * // A failure-aware alphabet, when a retried tool call should not look like a
 * // successful one.
 * const outcomeSignature = Analyzer.collect<string>().pipe(
 *   Analyzer.mapInput((step: Step.Any) =>
 *     Step.isFailed(step) ? `${Step.label(step)}!` : Step.label(step),
 *   ),
 * );
 * ```
 */
export type Signature = ReadonlyArray<string>;

export const signature: Analyzer<Step.Any, Signature> = collect<string>().pipe(
  mapInput(Step.label),
);

/**
 * Token spend of a trajectory, aggregated over every model request.
 */
export type Usage = Readonly<{
  /** Number of model requests, i.e. how many times the agent called the model. */
  requests: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}>;

const emptyUsage: Usage = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/**
 * Sums the token usage reported by the provider.
 *
 * Attributing cost is the first question asked of a trajectory that took too
 * long or cost too much, and `cacheReadTokens` against `inputTokens` shows
 * whether prompt caching is working at all.
 *
 * @example
 * ```ts
 * const usage = yield* Analyzer.run(trajectory, Analyzer.usage);
 * const cacheHitRate = usage.cacheReadTokens / usage.inputTokens;
 * ```
 */
export const usage: Analyzer<Step.Any, Usage> = reduce(
  (): Usage => emptyUsage,
  (total, step: Step.Finish): Usage => ({
    requests: total.requests + 1,
    inputTokens: total.inputTokens + (step.usage.inputTokens.total ?? 0),
    outputTokens: total.outputTokens + (step.usage.outputTokens.total ?? 0),
    reasoningTokens: total.reasoningTokens + (step.usage.outputTokens.reasoning ?? 0),
    cacheReadTokens: total.cacheReadTokens + (step.usage.inputTokens.cacheRead ?? 0),
    cacheWriteTokens: total.cacheWriteTokens + (step.usage.inputTokens.cacheWrite ?? 0),
  }),
).pipe(filterInput(Step.isFinish));

/**
 * How a single tool was used.
 */
export type ToolUsage = Readonly<{
  calls: number;
  /** Calls answered with a failure. */
  failures: number;
  /** Calls the trajectory never answered. */
  unresolved: number;
}>;

export type ToolReport = Readonly<{ [name: string]: ToolUsage }>;

const countCall = (usage: ToolUsage | undefined, step: Step.ToolCall<any>): ToolUsage => {
  const current = usage ?? { calls: 0, failures: 0, unresolved: 0 };
  return {
    calls: current.calls + 1,
    failures: current.failures + (Step.isFailed(step) ? 1 : 0),
    unresolved: current.unresolved + (Step.isUnresolved(step) ? 1 : 0),
  };
};

/**
 * Tool usage of a trajectory, keyed by tool name.
 *
 * A tool whose failure rate is high is either broken or badly described to the
 * model, and unresolved calls mark the point where a run was cut short.
 *
 * @example
 * ```ts
 * const tools = yield* Analyzer.run(trajectory, Analyzer.tools);
 * const flaky = Object.entries(tools).filter(([, use]) => use.failures / use.calls > 0.2);
 * ```
 */
export const tools: Analyzer<Step.Any, ToolReport> = reduce(
  (): ToolReport => ({}),
  (report, step: Step.ToolCall<any>): ToolReport => ({
    ...report,
    [step.call.name]: countCall(report[step.call.name], step),
  }),
).pipe(filterInput(Step.isToolCall));

/**
 * A tool call the agent made more than once with the very same parameters.
 */
export type Repetition = Readonly<{
  /** Label of the repeated call, e.g. `tool:bash`. */
  label: string;
  /** How many times the identical call was made. */
  count: number;
  /** Step indices of the identical calls. */
  indices: ReadonlyArray<number>;
}>;

/**
 * Finds tool calls that were repeated verbatim.
 *
 * Identical repeated calls are the cheapest reliable signal that an agent is
 * stuck: it re-reads the same file, re-runs the same failing test, or loops
 * between two actions instead of making progress. Parameters are compared by
 * structural hash, so the fold stays small on trajectories with large payloads.
 *
 * @example
 * ```ts
 * const repeated = yield* Analyzer.run(trajectory, Analyzer.repetitions);
 * // [{ label: "tool:bash", count: 7, indices: [12, 15, 18, 21, 24, 27, 30] }]
 * const wasted = repeated.reduce((total, one) => total + one.count - 1, 0);
 * ```
 */
export const repetitions: Analyzer<Step.Any, ReadonlyArray<Repetition>> = make({
  initial: (): Map<string, Repetition> => new Map(),
  step: (seen, step: Step.ToolCall<any>) => {
    const label = Step.label(step);
    const key = `${label}#${Hash.hash(step.call.params)}`;
    const current = seen.get(key);
    seen.set(key, {
      label,
      count: (current?.count ?? 0) + 1,
      indices: [...(current?.indices ?? []), step.index],
    });
    return seen;
  },
  result: (seen) =>
    Array.from(seen.values())
      .filter((one) => one.count > 1)
      .sort((left, right) => right.count - left.count),
}).pipe(filterInput(Step.isToolCall));

/**
 * Runs an analyzer over a trajectory.
 *
 * The trajectory is streamed once and never materialized, so the memory cost is
 * the cost of the analyzer's state.
 *
 * @example
 * ```ts
 * const report = yield* Analyzer.run(trajectory, Analyzer.all({
 *   usage: Analyzer.usage,
 *   tools: Analyzer.tools,
 * }));
 * ```
 */
export const run = <Tools extends Record<string, Tool.Any>, A>(
  trajectory: Trajectory.Trajectory<Tools>,
  analyzer: Analyzer<Step.Step<Tools>, A>,
): Effect.Effect<A, Trajectory.TrajectoryError> =>
  Step.stream(trajectory).pipe(
    Stream.runFold(analyzer.initial, analyzer.step),
    Effect.map(analyzer.result),
  );

/**
 * Runs one analyzer over many trajectories, keeping their ids.
 *
 * This is the entry point for every cross-trajectory question: the same analyzer
 * applied to a whole cohort produces comparable results, which the {@link Compare}
 * facilities then turn into summaries, distances and contrasts.
 *
 * @example
 * ```ts
 * // Five trials of the same task, one report each.
 * const reports = yield* Analyzer.runAll(trials, Analyzer.all({
 *   usage: Analyzer.usage,
 *   signature: Analyzer.signature,
 * }));
 * ```
 */
export const runAll = <Tools extends Record<string, Tool.Any>, A>(
  trajectories: Readonly<{ [id: string]: Trajectory.Trajectory<Tools> }>,
  analyzer: Analyzer<Step.Step<Tools>, A>,
  options?: Readonly<{ concurrency?: Types.Concurrency }>,
): Effect.Effect<Readonly<{ [id: string]: A }>, Trajectory.TrajectoryError> =>
  Effect.all(
    Object.fromEntries(
      Object.entries(trajectories).map(([id, trajectory]) => [id, run(trajectory, analyzer)]),
    ),
    { concurrency: options?.concurrency ?? "unbounded" },
  );
