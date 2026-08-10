import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Prompt, Sandbox } from "@open-insight/core/internal";
import * as Context from "./index.ts";
import * as Middle from "./middleware.ts";

const fakeSandbox = {} as Sandbox.Sandbox;

const prompt = (text: string): Prompt.Prompt => Prompt.make([{ role: "user", content: text }]);

describe("Context.make", () => {
  it.effect("applies pre-prompt middlewares in order", () =>
    Effect.gen(function* () {
      const ctx = yield* Context.make();
      for (const suffix of ["a", "b"]) {
        const mw = yield* Middle.makePrePrompt(
          (state) =>
            Effect.succeed({
              ...state,
              prompt: Prompt.concat(state.prompt, Prompt.make([{ role: "user", content: suffix }])),
            }),
          { name: `append-${suffix}` },
        );
        ctx.middlewares.add(mw);
      }

      const result = yield* ctx.applyPrePrompt({
        ...fakeSandbox,
        trajectory: Prompt.empty,
        prompt: prompt("hi"),
      });

      assert.strictEqual(result.prompt.content.length, 3);
      assert.strictEqual(result.prompt.content[1].role, "user");
      assert.strictEqual(result.prompt.content[2].role, "user");
    }),
  );

  it.effect("after-respond middlewares fold the trajectory into responded", () =>
    Effect.gen(function* () {
      const ctx = yield* Context.make();
      const mw = yield* Middle.makeAfterRespond(
        (state) =>
          Effect.succeed({
            ...state,
            responded: Prompt.concat(state.responded, state.trajectory),
          }),
        { name: "fold-trajectory" },
      );
      ctx.middlewares.add(mw);

      const result = yield* ctx.applyAfterRespond({
        ...fakeSandbox,
        trajectory: Prompt.concat(prompt("q"), prompt("a")),
        responded: prompt("r"),
      });

      assert.strictEqual(result.responded.content.length, 3);
      assert.deepStrictEqual(Object.keys(result), ["trajectory", "responded"]);
    }),
  );

  it.effect("pre-prompt and after-respond middlewares are filtered by kind", () =>
    Effect.gen(function* () {
      const ctx = yield* Context.make();
      const wipe = yield* Middle.makeAfterRespond(
        (state) => Effect.succeed({ ...state, trajectory: Prompt.empty }),
        { name: "wipe" },
      );
      ctx.middlewares.add(wipe);

      const pre = yield* ctx.applyPrePrompt({
        ...fakeSandbox,
        trajectory: prompt("history"),
        prompt: prompt("next"),
      });
      assert.strictEqual(pre.trajectory.content.length, 1);

      const after = yield* ctx.applyAfterRespond({
        ...fakeSandbox,
        trajectory: prompt("history"),
        responded: prompt("resp"),
      });
      assert.strictEqual(after.trajectory.content.length, 0);
    }),
  );

  it.effect("registers after-respond middlewares through the Service", () =>
    Effect.gen(function* () {
      const ctx = yield* Context.Service;
      yield* Context.registerAfterRespond(
        (state) => Effect.succeed({ ...state, trajectory: Prompt.empty }),
        { name: "wipe" },
      )(Effect.void);

      const result = yield* ctx.applyAfterRespond({
        ...fakeSandbox,
        trajectory: prompt("history"),
        responded: prompt("resp"),
      });
      assert.strictEqual(result.trajectory.content.length, 0);
    }).pipe(Effect.provide(Context.layer)),
  );

  it.effect("registers pre-prompt middlewares through the Service", () =>
    Effect.gen(function* () {
      const ctx = yield* Context.Service;
      yield* Context.registerPrePrompt(
        (state) =>
          Effect.succeed({
            ...state,
            prompt: Prompt.concat(state.prompt, Prompt.make([{ role: "user", content: "!" }])),
          }),
        { name: "exclaim" },
      )(Effect.void);

      const result = yield* ctx.applyPrePrompt({
        ...fakeSandbox,
        trajectory: Prompt.empty,
        prompt: prompt("hi"),
      });
      assert.strictEqual(result.prompt.content.length, 2);
      const after = yield* ctx.applyAfterRespond({
        ...fakeSandbox,
        trajectory: prompt("history"),
        responded: prompt("resp"),
      });
      assert.strictEqual(after.trajectory.content.length, 1);
    }).pipe(Effect.provide(Context.layer)),
  );

  it.effect("a chain of middlewares feeds each output into the next", () =>
    Effect.gen(function* () {
      const ctx = yield* Context.make();
      const append = (suffix: string) =>
        Middle.makePrePrompt(
          (state) =>
            Effect.succeed({
              ...state,
              prompt: Prompt.concat(state.prompt, Prompt.make([{ role: "user", content: suffix }])),
            }),
          { name: `append-${suffix}` },
        );
      ctx.middlewares.add(yield* append("a"));
      ctx.middlewares.add(yield* append("b"));

      const result = yield* ctx.applyPrePrompt({
        ...fakeSandbox,
        trajectory: Prompt.empty,
        prompt: prompt("hi"),
      });

      assert.strictEqual(result.prompt.content.length, 3);
      const last = result.prompt.content.at(-1);
      assert.deepStrictEqual(last, Prompt.make([{ role: "user", content: "b" }]).content[0]);
    }),
  );

  it.effect("empty middleware set returns the input unchanged", () =>
    Effect.gen(function* () {
      const ctx = yield* Context.make();
      const pre = yield* ctx.applyPrePrompt({
        ...fakeSandbox,
        trajectory: prompt("t"),
        prompt: prompt("p"),
      });
      assert.strictEqual(pre.prompt.content.length, 1);
      assert.strictEqual(pre.trajectory.content.length, 1);

      const after = yield* ctx.applyAfterRespond({
        ...fakeSandbox,
        trajectory: prompt("t"),
        responded: prompt("r"),
      });
      assert.strictEqual(after.responded.content.length, 1);
    }),
  );
});
