import { Prompt } from "@open-insight/core/internal";
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { type Context, makePromptFn, type PromptFactory, type PromptFnPromise } from "./prompt.ts";

function shell(_strings: TemplateStringsArray, ..._values: ReadonlyArray<unknown>): Promise<string>;
function shell(
  _options: object,
): (_strings: TemplateStringsArray, ..._values: ReadonlyArray<unknown>) => Promise<string>;
function shell(
  first: TemplateStringsArray | object,
):
  | Promise<string>
  | ((_strings: TemplateStringsArray, ..._values: ReadonlyArray<unknown>) => Promise<string>) {
  return Array.isArray(first) ? Promise.resolve("") : shell;
}

const unavailable = async () => {
  throw new globalThis.Error("not available in this test");
};

const makeContext = (trajectory: Prompt.Trajectory): Context => ({
  $: shell,
  cmd: unavailable,
  readFile: async ({ sandboxPath }) => `contents of ${sandboxPath}`,
  download: unavailable,
  trajectory,
});

it.effect("provides dynamic prompt functions with trajectory and read-only sandbox access", () =>
  Effect.gen(function* () {
    const contexts: Array<Context> = [];
    const prompt = makePromptFn(async (context) => {
      contexts.push(context);
      return context.readFile({ sandboxPath: "/workspace/status.txt" });
    });
    const context = makeContext(Prompt.make("previous request"));

    const result = yield* prompt(context);

    assert.strictEqual(contexts[0], context);
    assert.deepStrictEqual(result, Prompt.make("contents of /workspace/status.txt"));
  }),
);

it.effect("passes the latest context back into stateful follow-ups", () =>
  Effect.gen(function* () {
    const contexts: Array<Context> = [];
    const followUp: PromptFactory = async function* (context) {
      contexts.push(context);
      const nextContext = yield "first follow-up";
      contexts.push(nextContext);
    };
    const prompt = makePromptFn({ init: "initial prompt", followUp });
    const initialContext = makeContext(Prompt.empty);
    const firstContext = makeContext(Prompt.make("first response"));
    const secondContext = makeContext(Prompt.make("second response"));

    assert.deepStrictEqual(yield* prompt(initialContext), Prompt.make("initial prompt"));
    assert.deepStrictEqual(yield* prompt(firstContext), Prompt.make("first follow-up"));
    assert.isNull(yield* prompt(secondContext));
    assert.deepStrictEqual(contexts, [firstContext, secondContext]);
  }),
);

it("excludes mutating sandbox operations from prompt contexts", () => {
  const prompt: PromptFnPromise = async (context) => {
    // @ts-expect-error Prompt callbacks cannot write directly to the sandbox.
    void context.writeFile;
    // @ts-expect-error Prompt callbacks cannot upload files into the sandbox.
    void context.upload;
    // @ts-expect-error Prompt callbacks cannot expose sandbox ports.
    void context.expose;
    return null;
  };

  assert.isFunction(prompt);
});
