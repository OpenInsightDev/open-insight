/**
 * Trajectory analysis for agent runs.
 *
 * The package is three layers, each usable on its own:
 *
 * - {@link Step} normalizes a `Trajectory` into a flat, indexed sequence of
 *   agent actions, with tool calls paired to their results. This is the
 *   representation everything else is written against.
 * - {@link Analyzer} describes folds over those steps as plain values, combines
 *   them so any number of questions are answered in one streaming pass, and runs
 *   them over one trajectory ({@link Analyzer.run}) or a whole cohort
 *   ({@link Analyzer.runAll}).
 * - {@link Compare} turns cohorts of results into the cross-trajectory answers:
 *   distributions, divergence points, behavioural distance, and the labels that
 *   separate one group of runs from another.
 *
 * @example
 * ```ts
 * import { Analyzer, Compare } from "@open-insight/trace";
 *
 * const program = Effect.gen(function* () {
 *   const reports = yield* Analyzer.runAll(trials, Analyzer.all({
 *     usage: Analyzer.usage,
 *     tools: Analyzer.tools,
 *     repeated: Analyzer.repetitions,
 *     signature: Analyzer.signature,
 *   }));
 *
 *   // Is trial-3's token spend an outlier, or is the task just expensive?
 *   const spend = Compare.summarize(Record.map(reports, (one) => one.usage.outputTokens));
 *
 *   // Do identically configured trials even behave the same way?
 *   const spread = Compare.summarize(
 *     Compare.pairwise(Record.map(reports, (one) => one.signature), Compare.distance),
 *   );
 * });
 * ```
 */
export * as Step from "./step.ts";
export * as Analyzer from "./analyzer.ts";
export * as Compare from "./compare.ts";
