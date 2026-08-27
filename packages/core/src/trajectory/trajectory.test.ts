import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Prompt } from "effect/unstable/ai";
import { fromPrompt, messages } from "./trajectory.ts";

it.effect("splits prompt content into turns at assistant messages", () =>
  Effect.gen(function* () {
    const prompt = Prompt.make([
      { role: "system", content: "Be concise." },
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question" },
      { role: "assistant", content: "Second answer" },
    ]);

    const turns = Array.from(yield* fromPrompt(prompt).turns().pipe(Stream.runCollect));

    assert.lengthOf(turns, 2);
    assert.deepStrictEqual(
      turns.map((turn) => turn.prompt.map((message) => message.role)),
      [["system", "user"], ["user"]],
    );
    assert.deepStrictEqual(
      Array.from(yield* turns[0]!.response.pipe(Stream.runCollect)).map(
        (part) => part.type === "text" && part.text,
      ),
      ["First answer"],
    );
    assert.deepStrictEqual(
      Array.from(yield* turns[1]!.response.pipe(Stream.runCollect)).map(
        (part) => part.type === "text" && part.text,
      ),
      ["Second answer"],
    );
  }),
);

it.effect("keeps a trailing unanswered prompt as an empty-response turn", () =>
  Effect.gen(function* () {
    const prompt = Prompt.make([
      { role: "user", content: "Answered" },
      { role: "assistant", content: "Answer" },
      { role: "user", content: "Pending" },
    ]);

    const turns = Array.from(yield* fromPrompt(prompt).turns().pipe(Stream.runCollect));

    assert.lengthOf(turns, 2);
    assert.strictEqual(turns[1]!.prompt[0]!.role, "user");
    assert.isEmpty(Array.from(yield* turns[1]!.response.pipe(Stream.runCollect)));
  }),
);

it.effect("reconstructs messages from the generated trajectory", () =>
  Effect.gen(function* () {
    const prompt = Prompt.make([
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer" },
      { role: "user", content: "Follow-up" },
    ]);

    const reconstructed = Array.from(yield* messages(fromPrompt(prompt)).pipe(Stream.runCollect));

    assert.deepStrictEqual(
      reconstructed.map((message) => message.role),
      ["user", "assistant", "user"],
    );
  }),
);
