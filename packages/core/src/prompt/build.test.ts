import { assert, it } from "@effect/vitest";
import { Effect, Ref, Stream } from "effect";
import { Prompt } from "effect/unstable/ai";
import { makeStream } from "./build.ts";

const sandbox = {
  $: (async () => "") as any,
  cmd: async () => ({}) as any,
  readFile: async () => "",
  download: async () => {},
  expose: async () => ({ hostUrl: "" }),
};

const userText = (prompt: Prompt.Prompt): string =>
  prompt.content
    .flatMap((message) =>
      message.role === "user"
        ? message.content.filter((part) => part.type === "text").map((part) => part.text)
        : [],
    )
    .join("");

it("static: emits the init once, and every fresh stream emits it again", () =>
  Effect.gen(function* () {
    const trajectory = yield* Ref.make(Prompt.empty);
    const input = { trajectory, sandbox };
    const prompts = yield* makeStream("hello", input).pipe(Stream.runCollect);
    assert.strictEqual(prompts.length, 1);
    assert.strictEqual(userText(prompts[0]!), "hello");
    // every `makeStream` call is a fresh stage run
    const again = yield* makeStream("hello", input).pipe(Stream.runCollect);
    assert.strictEqual(again.length, 1);
  }).pipe(Effect.runPromise));

it("fn: Ref.gets the latest trajectory on every pull", () =>
  Effect.gen(function* () {
    const trajectory = yield* Ref.make(Prompt.empty);
    let count = 0;
    const seen: Array<string> = [];
    const input = { trajectory, sandbox };

    const prompts: Array<Prompt.Prompt> = [];
    yield* makeStream(async (context) => {
      seen.push(userText(context.trajectory));
      count += 1;
      return count < 3 ? `prompt-${count}` : null;
    }, input).pipe(
      Stream.runForEach((prompt) =>
        Effect.gen(function* () {
          prompts.push(prompt);
          // agent loop: respond, then the response lands in the trajectory
          yield* Ref.set(trajectory, Prompt.make(`agent-${count}`));
        }),
      ),
    );

    assert.deepStrictEqual(
      prompts.map((p) => userText(p)),
      ["prompt-1", "prompt-2"],
    );
    // each pull saw the trajectory as it was at pull time, then the loop updated it
    assert.deepStrictEqual(seen, ["", "agent-1", "agent-2"]);
  }).pipe(Effect.runPromise));

it("followUp: emits init, then feeds each pull context into the iterator", () =>
  Effect.gen(function* () {
    const trajectory = yield* Ref.make(Prompt.empty);
    const input = { trajectory, sandbox };

    const prompts: Array<Prompt.Prompt> = [];
    yield* makeStream(
      {
        init: "init-msg",
        followUp: async function* (context) {
          let latest = context;
          for (let i = 0; i < 2; i++) {
            const message = `follow-${i}-${userText(latest.trajectory)}`;
            latest = yield message;
          }
        },
      },
      input,
    ).pipe(
      Stream.runForEach((prompt) =>
        Effect.gen(function* () {
          prompts.push(prompt);
          yield* Ref.set(trajectory, Prompt.make(`agent-${userText(prompt)}`));
        }),
      ),
    );

    assert.deepStrictEqual(
      prompts.map((p) => userText(p)),
      ["init-msg", "follow-0-agent-init-msg", "follow-1-agent-follow-0-agent-init-msg"],
    );
  }).pipe(Effect.runPromise));

it("followUp without init: iterator created from the first pull context", () =>
  Effect.gen(function* () {
    const trajectory = yield* Ref.make(Prompt.empty);
    const prompts = yield* makeStream(
      {
        followUp: async function* () {
          yield "only";
        },
      },
      { trajectory, sandbox },
    ).pipe(Stream.runCollect);
    assert.deepStrictEqual(
      prompts.map((p) => userText(p)),
      ["only"],
    );
  }).pipe(Effect.runPromise));
