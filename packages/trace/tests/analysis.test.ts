import { Effect, Option } from "effect";
import { expect, test } from "vite-plus/test";
import { Analyzer, Compare, Step } from "../src/index.ts";
import { call, finish, message, prompt, reasoning, result, trajectory } from "./fixture.ts";

/** A run that never gets the test suite green and dies of context exhaustion. */
const stuck = trajectory(
  prompt("make the failing test pass"),
  reasoning("run the tests first"),
  call("c1", "bash", { command: "pytest" }),
  result("c1", "bash", { isFailure: true }),
  call("c2", "read_file", { path: "app.py" }),
  result("c2", "read_file"),
  call("c3", "bash", { command: "pytest" }),
  result("c3", "bash", { isFailure: true }),
  call("c4", "bash", { command: "pytest" }),
  result("c4", "bash", { isFailure: true }),
  call("c5", "bash", { command: "pytest -x" }),
  finish("length", { input: 8_000, output: 900, cacheRead: 6_000 }),
);

/** A run that reads, edits, verifies and reports. */
const clean = trajectory(
  prompt("make the failing test pass"),
  reasoning("look at the test first"),
  call("c1", "read_file", { path: "test_app.py" }),
  result("c1", "read_file"),
  call("c2", "edit_file", { path: "app.py" }),
  result("c2", "edit_file"),
  call("c3", "bash", { command: "pytest" }),
  result("c3", "bash"),
  message("Fixed: the parser dropped the trailing newline."),
  finish("stop", { input: 4_000, output: 500, cacheRead: 3_000 }),
);

/** The same task solved the same way, after one extra look around. */
const searched = trajectory(
  prompt("make the failing test pass"),
  reasoning("look at the test first"),
  call("c0", "grep", { pattern: "newline" }),
  result("c0", "grep"),
  call("c1", "read_file", { path: "test_app.py" }),
  result("c1", "read_file"),
  call("c2", "edit_file", { path: "app.py" }),
  result("c2", "edit_file"),
  call("c3", "bash", { command: "pytest" }),
  result("c3", "bash"),
  message("Fixed: the parser dropped the trailing newline."),
  finish("stop", { input: 4_200, output: 520, cacheRead: 3_100 }),
);

test("steps pair tool calls with their result and keep unanswered calls visible", async () => {
  const steps = await Effect.runPromise(Analyzer.run(stuck, Analyzer.collect<Step.Any>()));

  expect(steps.map(Step.label)).toEqual([
    "input",
    "reasoning",
    "tool:bash",
    "tool:read_file",
    "tool:bash",
    "tool:bash",
    "finish:length",
    "tool:bash",
  ]);
  expect(steps.map((step) => step.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(steps.filter(Step.isFailed).map((step) => step.index)).toEqual([2, 4, 5]);
  expect(steps.filter(Step.isUnresolved).map((step) => step.index)).toEqual([7]);
});

test("steps number turns from prompts and ignore preliminary tool results", async () => {
  const followUp = trajectory(
    prompt("add a regression test"),
    call("c1", "bash", { command: "pytest" }),
    result("c1", "bash", { preliminary: true }),
    result("c1", "bash"),
    prompt("now update the changelog"),
    call("c2", "edit_file", { path: "CHANGELOG.md" }),
    result("c2", "edit_file"),
  );

  const steps = await Effect.runPromise(Analyzer.run(followUp, Analyzer.collect<Step.Any>()));

  expect(steps.map((step) => [Step.label(step), step.turn])).toEqual([
    ["input", 0],
    ["tool:bash", 0],
    ["input", 1],
    ["tool:edit_file", 1],
  ]);
});

test("one pass answers every question about a trajectory", async () => {
  const report = await Effect.runPromise(
    Analyzer.run(
      stuck,
      Analyzer.all({
        steps: Analyzer.count,
        usage: Analyzer.usage,
        tools: Analyzer.tools,
        repeated: Analyzer.repetitions,
        signature: Analyzer.signature,
      }),
    ),
  );

  expect(report.steps).toBe(8);
  expect(report.usage).toEqual({
    requests: 1,
    inputTokens: 8_000,
    outputTokens: 900,
    reasoningTokens: 0,
    cacheReadTokens: 6_000,
    cacheWriteTokens: 0,
  });
  expect(report.tools).toEqual({
    bash: { calls: 4, failures: 3, unresolved: 1 },
    read_file: { calls: 1, failures: 0, unresolved: 0 },
  });
  // The agent ran the very same command three times: it was looping, not working.
  expect(report.repeated).toEqual([{ label: "tool:bash", count: 3, indices: [2, 4, 5] }]);
  expect(report.signature).toHaveLength(8);
});

test("combinators cover the questions that have no built-in analyzer", async () => {
  const report = await Effect.runPromise(
    Analyzer.run(
      stuck,
      Analyzer.all({
        // Where did it first go wrong?
        firstFailure: Analyzer.first<Step.ToolCall<any>>().pipe(Analyzer.filterInput(Step.isFailed)),
        // Why did it stop?
        outcome: Analyzer.last<Step.Finish>().pipe(Analyzer.filterInput(Step.isFinish)),
        // How much did it think?
        thoughts: Analyzer.count.pipe(Analyzer.filterInput(Step.isReasoning)),
      }),
    ),
  );

  expect(Option.map(report.firstFailure, (step) => step.index)).toEqual(Option.some(2));
  expect(Option.map(report.outcome, (step) => step.reason)).toEqual(Option.some("length"));
  expect(report.thoughts).toBe(1);
});

test("a cohort of trajectories is summarized, aligned and contrasted", async () => {
  const reports = await Effect.runPromise(
    Analyzer.runAll(
      { stuck, clean, searched },
      Analyzer.all({ usage: Analyzer.usage, signature: Analyzer.signature }),
    ),
  );

  const spend = Compare.summarize({
    stuck: reports.stuck.usage.inputTokens,
    clean: reports.clean.usage.inputTokens,
    searched: reports.searched.usage.inputTokens,
  });

  // The stuck run burned twice the context of the others, and it is named.
  expect(Option.map(spend, (one) => one.max)).toEqual(
    Option.some({ id: "stuck", value: 8_000 }),
  );
  expect(Option.map(spend, (one) => one.median)).toEqual(Option.some(4_200));

  // Two runs that solved the task the same way, one extra search apart.
  expect(Compare.divergence(reports.clean.signature, reports.searched.signature)).toEqual(
    Option.some({
      shared: 2,
      left: Option.some("tool:read_file"),
      right: Option.some("tool:grep"),
    }),
  );
  expect(Compare.divergence(reports.clean.signature, reports.clean.signature)).toEqual(
    Option.none(),
  );
  expect(Compare.distance(reports.clean.signature, reports.searched.signature)).toBeCloseTo(0.125);

  // Pairwise distance is the noise floor a claimed behavioural change has to beat.
  const spread = Compare.pairwise(
    { clean: reports.clean.signature, searched: reports.searched.signature },
    Compare.distance,
  );
  expect(Object.keys(spread)).toEqual(["clean vs searched"]);

  // What did the failing run do differently? It never edited a file, and it
  // stopped because it ran out of context.
  const contrast = Compare.contrast(
    [reports.stuck.signature],
    [reports.clean.signature, reports.searched.signature],
  );
  expect(contrast[0]).toEqual({ label: "finish:length", left: 1, right: 0, delta: 1 });
  expect(contrast.at(-1)?.delta).toBe(-1);
  expect(contrast.find((one) => one.label === "tool:edit_file")).toEqual({
    label: "tool:edit_file",
    left: 0,
    right: 1,
    delta: -1,
  });
});

test("n-grams contrast procedures instead of single actions", () => {
  const looping = Compare.ngrams(["tool:edit", "tool:bash", "tool:edit", "tool:bash"], 2);

  expect(looping).toEqual([
    "tool:edit > tool:bash",
    "tool:bash > tool:edit",
    "tool:edit > tool:bash",
  ]);
});
