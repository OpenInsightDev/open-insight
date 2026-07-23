import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Agent, Sandbox, Snapshot } from "@open-insight/core";
import { Crypto, Effect, Layer, Option, Queue, Stream } from "effect";
import { Prompt, Response } from "effect/unstable/ai";
import * as Task from "../task/index.ts";
import { type Event } from "./event/index.ts";
import { createTrail } from "./trail.ts";

const TestCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: (_algorithm, data) => Effect.succeed(data),
  }),
);

const sandbox = {
  spawn: () => Effect.die("unused sandbox operation"),
  exitCode: () => Effect.die("unused sandbox operation"),
  success: () => Effect.die("unused sandbox operation"),
  stdout: () => Effect.die("unused sandbox operation"),
  stderr: () => Effect.die("unused sandbox operation"),
  cmd: () => Effect.die("unused sandbox operation"),
  readFile: () => Effect.die("unused sandbox operation"),
  writeFile: () => Effect.die("unused sandbox operation"),
  download: () => Effect.die("unused sandbox operation"),
  upload: () => Effect.die("unused sandbox operation"),
  expose: () => Effect.die("unused sandbox operation"),
} satisfies Sandbox.Sandbox;

const makeLayer = Effect.fn(function* (agent: Agent.Agent) {
  const handle = yield* Snapshot.Handle.make(Snapshot.make({ image: "scratch" }));
  const sandboxProvider = {
    aquireSnapshot: () => Effect.succeed(handle),
    deriveSnapshot: () => Effect.die("snapshot derivation should not be used"),
    runSandbox: () => Effect.succeed(sandbox),
  } satisfies Sandbox.Provider;
  const agentProvider = {
    snapshotExtension: Option.none(),
    runSession: () => Effect.succeed(agent),
  } satisfies Agent.Provider;

  return Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(Sandbox.ProviderService)(sandboxProvider),
    Layer.succeed(Agent.ProviderService)(agentProvider),
  );
});

const makeUsage = (input: number, output: number) =>
  new Response.Usage({
    inputTokens: {
      uncached: input,
      total: input,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: output,
      text: output,
      reasoning: undefined,
    },
  });

const finishPart = (usage: Response.Usage) =>
  Response.makePart("finish", {
    reason: "stop",
    usage,
    response: undefined,
  });

describe("createTrail", () => {
  it.layer(TestCrypto)((it) => {
    it.effect("passes named stage results and publishes each stage usage", () =>
      Effect.gen(function* () {
        const firstGrade = { score: 1 };
        const secondGrade = { score: 2 };
        const firstUsage = makeUsage(10, 2);
        const secondUsage = makeUsage(20, 4);
        const retryUsage = makeUsage(30, 6);
        let promptIdx = 0;
        let attempts = 0;
        const agent = {
          trajectory: () => Effect.succeed(Prompt.empty),
          prompt: () => {
            const usage = [firstUsage, secondUsage, retryUsage][promptIdx];
            promptIdx += 1;
            if (usage === undefined) {
              return Stream.die("unexpected agent prompt");
            }
            return Stream.make(finishPart(usage));
          },
        } satisfies Agent.Agent;
        const layer = yield* makeLayer(agent);
        const queue = yield* Queue.unbounded<Event>();
        const task = yield* Task.make({
          id: "multi-stage",
          name: "multi-stage",
          snapshot: Snapshot.make({ image: "scratch" }),
        }).pipe(
          Task.stage("first", {
            prompt: Prompt.userMessage({ content: [Prompt.textPart({ text: "first" })] }),
            grader: async ({ results }) => {
              assert.deepStrictEqual(results, {});
              return firstGrade;
            },
          }),
          Task.stage("second", {
            prompt: Prompt.userMessage({ content: [Prompt.textPart({ text: "second" })] }),
            grader: async ({ results }) => {
              assert.deepStrictEqual(results, { first: firstGrade });
              if (attempts === 0) {
                attempts += 1;
                throw Prompt.userMessage({
                  content: [Prompt.textPart({ text: "retry second" })],
                });
              }
              return secondGrade;
            },
          }),
        );

        const runTrail = yield* createTrail({
          task,
          bench: "bench",
          harness: "harness",
          eventQueue: queue,
        }).pipe(Effect.provide(layer));
        const result = yield* runTrail;
        const events = yield* Queue.takeAll(queue);
        const stagedEvents = events.filter((event) => event._tag === "TrailStagedEvent");

        assert.deepStrictEqual(result, secondGrade);
        assert.deepStrictEqual(
          stagedEvents.map(({ stage, grade, usage }) => ({ stage, grade, usage })),
          [
            { stage: "first", grade: firstGrade, usage: firstUsage },
            { stage: "second", grade: secondGrade, usage: retryUsage },
          ],
        );
      }),
    );

    it.effect("passes named stage results while verifying graders", () =>
      Effect.gen(function* () {
        const firstGrade = { score: 1 };
        const secondGrade = { score: 2 };
        const agent = {
          trajectory: () => Effect.succeed(Prompt.empty),
          prompt: () => Stream.die("agent should not run in verification mode"),
        } satisfies Agent.Agent;
        const layer = yield* makeLayer(agent);
        const queue = yield* Queue.unbounded<Event>();
        const task = yield* Task.make({
          id: "multi-stage-verification",
          name: "multi-stage-verification",
          snapshot: Snapshot.make({ image: "scratch" }),
        }).pipe(
          Task.stage("first", {
            prompt: Prompt.userMessage({ content: [Prompt.textPart({ text: "first" })] }),
            grader: {
              verif: async () => null,
              grade: async ({ results }) => {
                assert.deepStrictEqual(results, {});
                return firstGrade;
              },
              expect: firstGrade,
            },
          }),
          Task.stage("second", {
            prompt: Prompt.userMessage({ content: [Prompt.textPart({ text: "second" })] }),
            grader: {
              verif: async () => null,
              grade: async ({ results }) => {
                assert.deepStrictEqual(results, { first: firstGrade });
                return secondGrade;
              },
              expect: secondGrade,
            },
          }),
        );

        const runTrail = yield* createTrail({
          task,
          bench: "bench",
          harness: "harness",
          eventQueue: queue,
          config: { verifMode: true },
        }).pipe(Effect.provide(layer));

        assert.deepStrictEqual(yield* runTrail, secondGrade);
      }),
    );

    it.effect("rejects a stage without a verifier in verification mode", () =>
      Effect.gen(function* () {
        const agent = {
          trajectory: () => Effect.succeed(Prompt.empty),
          prompt: () => Stream.die("agent should not run in verification mode"),
        } satisfies Agent.Agent;
        const layer = yield* makeLayer(agent);
        const queue = yield* Queue.unbounded<Event>();
        const task = yield* Task.make({
          id: "missing-stage-verifier",
          name: "missing-stage-verifier",
          snapshot: Snapshot.make({ image: "scratch" }),
        }).pipe(
          Task.stage("verifiable", {
            id: "verifiable-stage",
            prompt: Prompt.userMessage({ content: [Prompt.textPart({ text: "first" })] }),
            grader: {
              verif: async () => null,
              grade: async () => ({ score: 1 }),
              expect: { score: 1 },
            },
          }),
          Task.stage("unverifiable", {
            id: "unverifiable-stage",
            prompt: Prompt.userMessage({ content: [Prompt.textPart({ text: "second" })] }),
            grader: async () => ({ score: 2 }),
          }),
        );

        const error = yield* createTrail({
          task,
          bench: "bench",
          harness: "harness",
          eventQueue: queue,
          config: { verifMode: true },
        }).pipe(Effect.provide(layer), Effect.flip);

        assert.strictEqual(error.reason._tag, "MissingVerifier");
        if (error.reason._tag === "MissingVerifier") {
          assert.strictEqual(error.reason.task, "missing-stage-verifier");
          assert.strictEqual(error.reason.stage, "unverifiable-stage");
        }
      }),
    );
  });
});
