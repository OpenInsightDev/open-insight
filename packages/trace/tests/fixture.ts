import type { Trajectory as Traj } from "@open-insight/core/internal";
import { Data, Stream } from "effect";
import { Prompt, Response, Toolkit, type Tool } from "effect/unstable/ai";

/**
 * Trajectories under analysis usually come from storage through
 * `Trajectory.decode`. These helpers build them in memory instead, so the tests
 * exercise the analysis facilities and nothing else.
 */
export type Tools = Record<string, Tool.Any>;
export type Part = Traj.Part<Tools>;

class Trajectory extends Data.Class<{
  readonly toolkit: Toolkit.Toolkit<any>;
  readonly parts: Stream.Stream<Part, Traj.TrajectoryError>;
}> {}

export const trajectory = (...parts: ReadonlyArray<Part>): Traj.Trajectory<Tools> =>
  new Trajectory({ toolkit: Toolkit.empty, parts: Stream.fromIterable(parts) });

export const prompt = (text: string): Part => ({
  _tag: "Prompt",
  messages: [Prompt.userMessage({ content: [Prompt.textPart({ text })] })],
});

const response = (part: Response.PartView<Tools>): Part => ({ _tag: "Response", response: part });

export const reasoning = (text: string): Part => response(Response.makePart("reasoning", { text }));

export const message = (text: string): Part => response(Response.makePart("text", { text }));

export const call = (id: string, name: string, params: unknown): Part =>
  response(Response.makePart("tool-call", { id, name, params, providerExecuted: true }));

export const result = (
  id: string,
  name: string,
  options: Readonly<{ isFailure?: boolean; value?: unknown; preliminary?: boolean }> = {},
): Part =>
  response(
    Response.makePart("tool-result", {
      id,
      name,
      result: options.value ?? null,
      encodedResult: options.value ?? null,
      isFailure: options.isFailure ?? false,
      providerExecuted: true,
      preliminary: options.preliminary ?? false,
    }),
  );

export const finish = (
  reason: Response.FinishReason,
  tokens: Readonly<{ input: number; output: number; cacheRead?: number }>,
): Part =>
  response(
    Response.makePart("finish", {
      reason,
      usage: new Response.Usage({
        inputTokens: { total: tokens.input, cacheRead: tokens.cacheRead },
        outputTokens: { total: tokens.output },
      }),
    }),
  );
