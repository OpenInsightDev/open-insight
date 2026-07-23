import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Agent, Sandbox, Snapshot } from "@open-insight/core";
import { Crypto, Effect, Layer, Option, Queue, Schedule, Stream } from "effect";
import { Prompt, Response } from "effect/unstable/ai";
import { When } from "../metric/when.ts";
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
          id: "multi-stage-id",
          name: "Multi-stage task",
          snapshot: Snapshot.make({ image: "scratch" }),
        }).pipe(
          Task.stage("first", {
            id: "first-stage-id",
            prompt: Prompt.userMessage({ content: [Prompt.textPart({ text: "first" })] }),
            grader: async ({ results }) => {
              assert.deepStrictEqual(results, {});
              return firstGrade;
            },
          }),
          Task.stage("second", {
            id: "second-stage-id",
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
        const result = yield* runTrail(7);
        const events = yield* Queue.takeAll(queue);
        const streamEvents = events.filter((event) => event._tag === "TrailStreamEvent");
        const stagedEvents = events.filter((event) => event._tag === "TrailStagedEvent");

        assert.deepStrictEqual(result, secondGrade);
        assert.strictEqual(streamEvents.length, 3);
        for (const event of streamEvents) {
          assert.strictEqual(event.task, "multi-stage-id");
          assert.strictEqual(event.trailIdx, 7);
        }
        assert.deepStrictEqual(
          stagedEvents.map(({ task, trailIdx, stage, grade, usage }) => ({
            task,
            trailIdx,
            stage,
            grade,
            usage,
          })),
          [
            {
              task: "multi-stage-id",
              trailIdx: 7,
              stage: "first-stage-id",
              grade: firstGrade,
              usage: firstUsage,
            },
            {
              task: "multi-stage-id",
              trailIdx: 7,
              stage: "second-stage-id",
              grade: secondGrade,
              usage: retryUsage,
            },
          ],
        );
      }),
    );

    it.effect("runs exec trajectory metrics and publishes matching results", () =>
      Effect.gen(function* () {
        const usage = makeUsage(10, 2);
        let promptIdx = 0;
        let metricChecks = 0;
        const toolTrajectory = Prompt.make([
          Prompt.userMessage({ content: [Prompt.textPart({ text: "task" })] }),
          Prompt.assistantMessage({ content: [Prompt.textPart({ text: "checking" })] }),
          Prompt.toolMessage({
            content: [
              Prompt.makePart("tool-result", {
                id: "tool-1",
                name: "read",
                result: "done",
                isFailure: false,
              }),
            ],
          }),
        ]);
        const agent = {
          trajectory: () => Effect.succeed(promptIdx < 2 ? Prompt.empty : toolTrajectory),
          prompt: () => {
            promptIdx += 1;
            return promptIdx === 1
              ? Stream.make(finishPart(usage))
              : Stream.make(finishPart(usage));
          },
        } satisfies Agent.Agent;
        const layer = yield* makeLayer(agent);
        const queue = yield* Queue.unbounded<Event>();
        const task = yield* Task.make({
          id: "trajectory-metric-task",
          name: "Trajectory metric task",
          snapshot: Snapshot.make({ image: "scratch" }),
          trajMetrics: [
            {
              id: "matching-metric",
              when: When.Exec({
                exec: async ({ results, trajectory: current }) => {
                  assert.deepStrictEqual(results, {});
                  assert.strictEqual(current, toolTrajectory);
                  metricChecks += 1;
                  return true;
                },
              }),
              exec: async ({ trajectory: current }) => ({
                messages: current.content.length,
              }),
            },
            {
              id: "skipped-metric",
              when: When.Exec({ exec: async () => false }),
              exec: async () => ({ unexpected: true }),
            },
          ],
        }).pipe(
          Task.stage("only", {
            prompt: Prompt.make([
              Prompt.userMessage({ content: [Prompt.textPart({ text: "text-only" })] }),
              Prompt.userMessage({ content: [Prompt.textPart({ text: "with-tool" })] }),
            ]),
            grader: async () => ({ score: 1 }),
          }),
        );

        const runTrail = yield* createTrail({
          task,
          bench: "bench",
          harness: "harness",
          eventQueue: queue,
        }).pipe(Effect.provide(layer));
        yield* runTrail(3);
        assert.strictEqual(metricChecks, 1);

        const events = yield* Queue.takeAll(queue);
        const metricEvents = events.filter((event) => event._tag === "TrajMetricEvent");
        assert.deepStrictEqual(
          metricEvents.map(({ bench, harness, task, trailIdx, id, result }) => ({
            bench,
            harness,
            task,
            trailIdx,
            id,
            result,
          })),
          [
            {
              bench: "bench",
              harness: "harness",
              task: "trajectory-metric-task",
              trailIdx: 3,
              id: "matching-metric",
              result: { messages: 3 },
            },
          ],
        );
      }),
    );

    it.effect("runs scheduled trajectory metrics during the trail", () =>
      Effect.gen(function* () {
        let releasePrompt: (() => void) | undefined;
        const waitForMetric = new Promise<void>((resolve) => {
          releasePrompt = resolve;
        });
        const agent = {
          trajectory: () => Effect.succeed(Prompt.empty),
          prompt: () =>
            Stream.fromEffect(
              Effect.promise(() => waitForMetric).pipe(Effect.as(finishPart(makeUsage(1, 1)))),
            ),
        } satisfies Agent.Agent;
        const layer = yield* makeLayer(agent);
        const queue = yield* Queue.unbounded<Event>();
        const task = yield* Task.make({
          id: "scheduled-trajectory-metric-task",
          name: "Scheduled trajectory metric task",
          snapshot: Snapshot.make({ image: "scratch" }),
          trajMetrics: [
            {
              id: "scheduled-metric",
              when: When.Schedule(Schedule.recurs(1)),
              exec: async () => {
                releasePrompt?.();
                return { samples: 1 };
              },
            },
          ],
        }).pipe(
          Task.stage("only", {
            prompt: Prompt.userMessage({ content: [Prompt.textPart({ text: "task" })] }),
            grader: async () => ({ score: 1 }),
          }),
        );

        const runTrail = yield* createTrail({
          task,
          bench: "bench",
          harness: "harness",
          eventQueue: queue,
        }).pipe(Effect.provide(layer));
        yield* runTrail(4);

        const events = yield* Queue.takeAll(queue);
        const metricEvents = events.filter((event) => event._tag === "TrajMetricEvent");
        assert.deepStrictEqual(
          metricEvents.map(({ trailIdx, id, result }) => ({ trailIdx, id, result })),
          [{ trailIdx: 4, id: "scheduled-metric", result: { samples: 1 } }],
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

        assert.deepStrictEqual(yield* runTrail(0), secondGrade);
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
