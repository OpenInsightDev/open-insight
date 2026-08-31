import { assert, describe, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Prompt, Response, Toolkit } from "effect/unstable/ai";
import { TrajectoryError } from "./error.ts";
import { Trajectory, type Part, type PromptPart } from "./trajectory.ts";
import { prompt, prompts, responses, turns } from "./view.ts";

const user = (text: string): Prompt.UserMessage =>
  Prompt.userMessage({ content: [Prompt.textPart({ text })] });
const promptPart = (...messages: Prompt.UserMessage[]): PromptPart => ({
  _tag: "Prompt",
  messages,
});
const responsePart = (text: string): Part<{}> => ({
  _tag: "Response",
  response: Response.makePart("text", { text }),
});
const trajectory = (...parts: ReadonlyArray<Part<{}>>): Trajectory<{}> =>
  new Trajectory({ toolkit: Toolkit.empty, parts: Stream.fromIterable(parts) });
const collect = <A, E>(stream: Stream.Stream<A, E>) =>
  stream.pipe(
    Stream.runCollect,
    Effect.map((items) => Array.from(items)),
  );

describe("trajectory views", () => {
  it.effect("groups parts into turns and flushes the final turn", () =>
    Effect.gen(function* () {
      const first = user("first");
      const second = user("second");
      const source = trajectory(
        responsePart("orphan"),
        promptPart(first),
        responsePart("one"),
        responsePart("two"),
        promptPart(second),
      );

      const result = yield* collect(turns(source));

      assert.deepStrictEqual(result, [
        {
          prompt: [first],
          response: [
            Response.makePart("text", { text: "one" }),
            Response.makePart("text", { text: "two" }),
          ],
        },
        { prompt: [second], response: [] },
      ]);
    }),
  );

  it.effect("emits an empty-response turn for consecutive prompts", () =>
    Effect.gen(function* () {
      const first = user("first");
      const second = user("second");
      const result = yield* collect(turns(trajectory(promptPart(first), promptPart(second))));

      assert.deepStrictEqual(result, [
        { prompt: [first], response: [] },
        { prompt: [second], response: [] },
      ]);
    }),
  );

  it.effect("returns no turns for trajectories without prompts", () =>
    Effect.gen(function* () {
      const result = yield* collect(turns(trajectory(responsePart("orphan"))));
      assert.deepStrictEqual(result, []);
    }),
  );

  it.effect("filters prompt and response parts independently", () =>
    Effect.gen(function* () {
      const message = user("hello");
      const originalPrompt = promptPart(message);
      const source = trajectory(originalPrompt, responsePart("answer"));

      const promptValues = yield* collect(prompts(source));
      const responseValues = yield* collect(responses(source));

      assert.deepStrictEqual(promptValues, [[message]]);
      assert.deepStrictEqual(responseValues, [Response.makePart("text", { text: "answer" })]);
      assert.notStrictEqual(promptValues[0], originalPrompt.messages);
    }),
  );

  it.effect("combines all turn prompts into one Prompt", () =>
    Effect.gen(function* () {
      const first = user("first");
      const second = user("second");
      const value = yield* prompt(
        trajectory(promptPart(first), responsePart("ignored"), promptPart(second)),
      );

      assert.deepStrictEqual(value.content, [first, second]);
    }),
  );

  it.effect("returns Prompt.empty for an empty trajectory", () =>
    Effect.gen(function* () {
      const value = yield* prompt(trajectory());
      assert.deepStrictEqual(value.content, []);
    }),
  );

  it.effect("preserves trajectory failures in every stream view", () =>
    Effect.gen(function* () {
      const failure = TrajectoryError.storage("offline");
      const source = new Trajectory<{}>({
        toolkit: Toolkit.empty,
        parts: Stream.fail(failure),
      });

      const turnsError = yield* collect(turns(source)).pipe(Effect.flip);
      const promptsError = yield* collect(prompts(source)).pipe(Effect.flip);
      const responsesError = yield* collect(responses(source)).pipe(Effect.flip);
      const promptError = yield* prompt(source).pipe(Effect.flip);

      assert.strictEqual(turnsError, failure);
      assert.strictEqual(promptsError, failure);
      assert.strictEqual(responsesError, failure);
      assert.strictEqual(promptError, failure);
    }),
  );
});
