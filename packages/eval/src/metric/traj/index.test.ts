import { Prompt } from "@open-insight/core/internal";
import { assert, it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";
import { Metadata } from "../metadata.ts";
import * as When from "../when/index.ts";
import { run, type Metric } from "./index.ts";

function shell(_strings: TemplateStringsArray, ..._values: ReadonlyArray<unknown>): Promise<string>;
function shell(
  _options: object,
): (_strings: TemplateStringsArray, ..._values: ReadonlyArray<unknown>) => Promise<string>;
function shell(first: TemplateStringsArray | object) {
  return Array.isArray(first) ? Promise.resolve("") : shell;
}

const unavailable = async () => {
  throw new globalThis.Error("not available in this test");
};

const sandbox = {
  $: shell,
  cmd: unavailable,
  readFile: unavailable,
  download: unavailable,
} satisfies When.SandboxContext;

it.effect("passes each metric its previous result", () =>
  Effect.gen(function* () {
    const previous: Array<Readonly<{ count: number }> | null> = [];
    const decodedParts: Array<Prompt.Part> = [];
    const metric: Metric<Readonly<{ count: number }>> = {
      when: When.traj(When.part("text")),
      exec: async (context, prev) => {
        previous.push(prev);
        decodedParts.push(...context.parts.slice(-1));
        return { count: (prev?.count ?? 0) + 1 };
      },
      chart: null,
      metadata: Metadata.make({
        id: "counter",
        name: Option.none(),
        description: Option.none(),
      }),
    };

    const encodedParts = [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ] satisfies ReadonlyArray<Prompt.PartEncoded>;
    const results = yield* Stream.fromIterable(encodedParts).pipe(
      run({ metrics: [metric], sandbox, prevTrajectory: Prompt.empty }),
      Stream.runCollect,
    );

    assert.deepStrictEqual(previous, [null, { count: 1 }]);
    assert.isTrue(decodedParts.every(Prompt.isPart));
    assert.deepStrictEqual(
      decodedParts.map((part) => part.options),
      [{}, {}],
    );
    assert.deepStrictEqual(
      Array.from(results, ({ result }) => result),
      [{ count: 1 }, { count: 2 }],
    );
  }),
);
