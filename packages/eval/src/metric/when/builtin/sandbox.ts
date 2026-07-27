import type { Pred } from "../index.ts";

/**
 * Use this sandbox predicate when the metric should wait for some command-driven state
 * to become valid, such as a passing test suite or a successful build.
 *
 * @example Waiting for tests to pass
 * ```ts
 * const whenTestsPass = When.schedule(When.recurs(10), {
 *   pred: When.success("pnpm test"),
 * });
 * ```
 */
export const success =
  (bash: string): Pred =>
  ({ $ }) =>
    $`${bash}`.then(() => true).catch(() => false);

/**
 * Use this sandbox predicate when the metric should wait for a command to keep failing,
 * for example while asserting that a file or service is still absent.
 *
 * @example Waiting for a file to remain missing
 * ```ts
 * const whenConfigIsStillMissing = When.schedule(When.recurs(5), {
 *   pred: When.fails("test -f /workspace/config.json"),
 * });
 * ```
 */
export const fails =
  (bash: string): Pred =>
  ({ $ }) =>
    $`${bash}`.then(() => false).catch(() => true);

/**
 * Use this sandbox predicate when the metric should wait for a generated file to reach
 * one exact expected value.
 *
 * @example Waiting for an output file to match exactly
 * ```ts
 * const whenAnswerMatches = When.schedule(When.recurs(10), {
 *   pred: When.content({
 *     sandboxPath: "/workspace/result.txt",
 *     expect: "done",
 *   }),
 * });
 * ```
 */
export const content =
  ({ sandboxPath, expect }: { sandboxPath: string; expect: string }): Pred =>
  ({ readFile }) =>
    readFile({ sandboxPath })
      .then((content) => content.trim() === expect)
      .catch(() => false);

/**
 * Use this sandbox predicate when the metric only cares that an output file exists and
 * is readable, regardless of its content.
 *
 * @example Waiting for an output file to appear
 * ```ts
 * const whenOutputExists = When.schedule(When.recurs(10), {
 *   pred: When.exists("/workspace/output.json"),
 * });
 * ```
 */
export const exists =
  (sandboxPath: string): Pred =>
  ({ readFile }) =>
    readFile({ sandboxPath }).then(() => true);
