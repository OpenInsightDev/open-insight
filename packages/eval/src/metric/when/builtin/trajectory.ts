import type { Prompt } from "@open-insight/core/internal";
import type { TrajPred } from "../index.ts";

type ToolCallPart = Extract<Prompt.Part, { type: "tool-call" }>;
type ToolResultPart = Extract<Prompt.Part, { type: "tool-result" }>;
export type ToolCallContext = Readonly<{
  call: ToolCallPart;
  result: ToolResultPart;
}>;
type ToolCallOptions = Readonly<{
  pred?: (context: ToolCallContext) => boolean;
}>;

type PartType = Prompt.Part["type"];
type PartOptions<Part extends Prompt.Part = Prompt.Part> = Readonly<{
  pred?: (part: Part) => boolean;
}>;
type PartsOf<Types extends ReadonlyArray<PartType>> = Types extends readonly []
  ? Prompt.Part
  : Extract<Prompt.Part, { type: Types[number] }>;

/**
 * Use this trajectory predicate when the metric should react to a specific kind of
 * conversation event, such as the assistant speaking or a tool finishing.
 *
 * Matches any trajectory part, or only parts of the given type. An optional
 * predicate can further filter matches based on the part's content.
 *
 * @example Waiting for a text response
 * ```ts
 * const whenTextAppears = When.traj(When.part("text"));
 * ```
 *
 * @example Waiting for matching text content
 * ```ts
 * const whenDone = When.traj(
 *   When.part("text", { pred: (part) => part.text.includes("done") }),
 * );
 * ```
 */
export function part(): TrajPred;
export function part(type: undefined, options: PartOptions): TrajPred;
export function part<const Type extends PartType>(
  type: Type,
  options?: PartOptions<Extract<Prompt.Part, { type: Type }>>,
): TrajPred;
export function part(type?: PartType, options: PartOptions = {}): TrajPred {
  return (part) => (type === undefined || part.type === type) && (options.pred?.(part) ?? true);
}

/**
 * Use this trajectory predicate when the metric should react to several part types
 * without writing a custom matcher.
 *
 * Matches any trajectory part, or parts whose type is included in the given list. An
 * optional final predicate can further filter matches based on the part's content.
 *
 * @example Waiting for either text or reasoning
 * ```ts
 * const whenModelResponds = When.traj(When.parts(["text", "reasoning"]));
 * ```
 *
 * @example Waiting for matching text or reasoning content
 * ```ts
 * const whenDone = When.traj(
 *   When.parts(["text", "reasoning"], { pred: (part) => part.text.includes("done") }),
 * );
 * ```
 */
export function parts(): TrajPred;
export function parts<const Types extends ReadonlyArray<PartType>>(
  types: Types,
  options?: PartOptions<PartsOf<Types>>,
): TrajPred;
export function parts(types: ReadonlyArray<PartType> = [], options: PartOptions = {}): TrajPred {
  return (part) =>
    (types.length === 0 || types.includes(part.type)) && (options.pred?.(part) ?? true);
}

/**
 * Use this trajectory predicate when the metric should wait for a specific tool to be
 * called, or for any tool result to appear in the trajectory.
 *
 * Matches a tool-result trajectory part with its corresponding tool-call part,
 * optionally filtered by tool name and content.
 *
 * @example Waiting for a specific tool call
 * ```ts
 * const whenBashRuns = When.traj(When.toolCall("bash"));
 * ```
 *
 * @example Waiting for a successful tool result
 * ```ts
 * const whenBashSucceeds = When.traj(
 *   When.toolCall("bash", {
 *     pred: ({ call, result }) => call.params !== undefined && !result.isFailure,
 *   }),
 * );
 * ```
 */
export const toolCall =
  (name?: string, options: ToolCallOptions = {}): TrajPred =>
  (part, { response }) => {
    if (part.type !== "tool-result") {
      return false;
    }

    const call = response.findLast(
      (candidate): candidate is ToolCallPart =>
        candidate.type === "tool-call" && candidate.id === part.id,
    );

    return (
      call !== undefined &&
      (name === undefined || call.name === name) &&
      (options.pred?.({ call, result: part }) ?? true)
    );
  };
