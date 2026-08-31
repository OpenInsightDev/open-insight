import { Match, Option, Stream } from "effect";
import type { Trajectory } from "@open-insight/core/internal";
import type { Response, Tool } from "effect/unstable/ai";

/**
 * Fields shared by every step.
 */
export type Base = Readonly<{
  /** Position of the step in the trajectory, starting at `0`. */
  index: number;
  /** Turn the step belongs to, where a turn starts at every new prompt. */
  turn: number;
}>;

/**
 * A new prompt was handed to the agent, opening a turn.
 */
export type Input = Base &
  Readonly<{
    _tag: "Input";
    messages: ReadonlyArray<Trajectory.PromptMessage>;
  }>;

/**
 * The agent thought out loud.
 */
export type Reasoning = Base &
  Readonly<{
    _tag: "Reasoning";
    text: string;
  }>;

/**
 * The agent emitted a message.
 */
export type Text = Base &
  Readonly<{
    _tag: "Text";
    text: string;
  }>;

/**
 * The agent invoked a tool.
 *
 * The result is `None` when the trajectory ends before the call is answered,
 * which is how abandoned and interrupted calls stay visible to analysis.
 */
export type ToolCall<Tools extends Record<string, Tool.Any>> = Base &
  Readonly<{
    _tag: "ToolCall";
    call: Response.ToolCallPartsView<Tools>;
    result: Option.Option<Response.ToolResultPartsView<Tools>>;
  }>;

/**
 * A model request completed, carrying its finish reason and token usage.
 */
export type Finish = Base &
  Readonly<{
    _tag: "Finish";
    reason: Response.FinishReason;
    usage: Response.Usage;
  }>;

/**
 * A single agent action, the unit every analyzer folds over.
 *
 * Steps are the intermediate representation of this package: a trajectory is a
 * stream of loosely related prompt and response parts, whereas steps are a flat,
 * indexed sequence of actions with tool calls already paired with their results.
 */
export type Step<Tools extends Record<string, Tool.Any>> =
  | Input
  | Reasoning
  | Text
  | ToolCall<Tools>
  | Finish;
export type Any = Step<any>;

export const isInput = (step: Any): step is Input => step._tag === "Input";
export const isReasoning = (step: Any): step is Reasoning => step._tag === "Reasoning";
export const isText = (step: Any): step is Text => step._tag === "Text";
export const isToolCall = (step: Any): step is ToolCall<any> => step._tag === "ToolCall";
export const isFinish = (step: Any): step is Finish => step._tag === "Finish";

/**
 * Whether the step is a tool call that came back as a failure.
 */
export const isFailed = (step: Any): step is ToolCall<any> =>
  isToolCall(step) && Option.isSome(step.result) && step.result.value.isFailure;

/**
 * Whether the step is a tool call that never received a result.
 */
export const isUnresolved = (step: Any): step is ToolCall<any> =>
  isToolCall(step) && Option.isNone(step.result);

/**
 * The canonical name of the action a step performed.
 *
 * Labels are the alphabet used to compare trajectories structurally: two runs
 * that produced the same labels in the same order did the same thing, whatever
 * the payloads were.
 *
 * @example
 * ```ts
 * // "input" | "reasoning" | "text" | "tool:bash" | "finish:stop"
 * const alphabet = steps.map(Step.label);
 * ```
 */
export const label: (step: Any) => string = Match.type<Any>().pipe(
  Match.tag("Input", () => "input"),
  Match.tag("Reasoning", () => "reasoning"),
  Match.tag("Text", () => "text"),
  Match.tag("ToolCall", (step) => `tool:${step.call.name}`),
  Match.tag("Finish", (step) => `finish:${step.reason}`),
  Match.exhaustive,
);

type State<Tools extends Record<string, Tool.Any>> = Readonly<{
  index: number;
  turn: number;
  started: boolean;
  pending: ReadonlyMap<string, Response.ToolCallPartsView<Tools>>;
}>;

const initial = <Tools extends Record<string, Tool.Any>>(): State<Tools> => ({
  index: 0,
  turn: 0,
  started: false,
  pending: new Map(),
});

type Emitted<Tools extends Record<string, Tool.Any>> = readonly [
  State<Tools>,
  ReadonlyArray<Step<Tools>>,
];

const skip = <Tools extends Record<string, Tool.Any>>(state: State<Tools>): Emitted<Tools> => [
  state,
  [],
];

const emit = <Tools extends Record<string, Tool.Any>>(
  state: State<Tools>,
  step: (base: Base) => Step<Tools>,
  pending: ReadonlyMap<string, Response.ToolCallPartsView<Tools>> = state.pending,
): Emitted<Tools> => [
  { ...state, index: state.index + 1, pending },
  [step({ index: state.index, turn: state.turn })],
];

const withPending = <Tools extends Record<string, Tool.Any>>(
  state: State<Tools>,
  update: (pending: Map<string, Response.ToolCallPartsView<Tools>>) => void,
): ReadonlyMap<string, Response.ToolCallPartsView<Tools>> => {
  const pending = new Map(state.pending);
  update(pending);
  return pending;
};

const next = <Tools extends Record<string, Tool.Any>>(
  state: State<Tools>,
  part: Trajectory.Part<Tools>,
): Emitted<Tools> => {
  if (part._tag === "Prompt") {
    const turn = state.started ? state.turn + 1 : 0;
    return emit({ ...state, turn, started: true }, (base) => ({
      ...base,
      _tag: "Input",
      messages: part.messages,
    }));
  }

  const response = part.response;
  switch (response.type) {
    case "reasoning":
      return emit(state, (base) => ({ ...base, _tag: "Reasoning", text: response.text }));

    case "text":
      return emit(state, (base) => ({ ...base, _tag: "Text", text: response.text }));

    case "finish":
      return emit(state, (base) => ({
        ...base,
        _tag: "Finish",
        reason: response.reason,
        usage: response.usage,
      }));

    case "tool-call":
      return skip({
        ...state,
        pending: withPending(state, (pending) => pending.set(response.id, response)),
      });

    case "tool-result": {
      // Providers report progress with preliminary results; only the final one
      // closes a call.
      if (response.preliminary) {
        return skip(state);
      }

      const call = state.pending.get(response.id);
      if (call === undefined) {
        return skip(state);
      }

      return emit(
        state,
        (base) => ({ ...base, _tag: "ToolCall", call, result: Option.some(response) }),
        withPending(state, (pending) => pending.delete(response.id)),
      );
    }

    default:
      return skip(state);
  }
};

const flush = <Tools extends Record<string, Tool.Any>>(
  state: State<Tools>,
): ReadonlyArray<Step<Tools>> =>
  Array.from(state.pending.values(), (call, offset): Step<Tools> => ({
    _tag: "ToolCall",
    index: state.index + offset,
    turn: state.turn,
    call,
    result: Option.none(),
  }));

/**
 * Normalizes a trajectory into the flat, indexed step sequence every analyzer
 * consumes.
 *
 * Tool calls are paired with their result by call id, so a `ToolCall` step is
 * emitted when the result arrives; calls left open when the trajectory ends are
 * emitted last with `result: None`. Parts that carry no agent action (files,
 * sources, response metadata, approval requests) are not steps.
 *
 * Use this directly for ad-hoc stream processing, and {@link Analyzer.run} when
 * folding the trajectory into a result.
 *
 * @example
 * ```ts
 * // Read the shell commands the agent ran, without loading the trajectory
 * // into memory.
 * const commands = yield* Step.stream(trajectory).pipe(
 *   Stream.filter(Step.isToolCall),
 *   Stream.filter((step) => step.call.name === "bash"),
 *   Stream.map((step) => step.call.params),
 *   Stream.runCollect,
 * );
 * ```
 */
export const stream = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory.Trajectory<Tools>,
): Stream.Stream<Step<Tools>, Trajectory.TrajectoryError> =>
  trajectory.parts.pipe(Stream.mapAccum(initial<Tools>, next, { onHalt: flush }));
