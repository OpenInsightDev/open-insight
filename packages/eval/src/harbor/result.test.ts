import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";
import { JobResult, TrailResult } from "./result.ts";

const trail = {
  id: "4c6a0354-67a0-4d74-b70c-f38f92bb7755",
  task_name: "hello-world",
  trial_name: "hello-world__abc1234",
  trial_uri: "file:///tmp/hello-world__abc1234",
  task_id: { path: "/tmp/hello-world" },
  source: null,
  task_checksum: "abc123",
  config: { task: { path: "/tmp/hello-world" } },
  agent_info: { name: "oracle", version: "1.0", model_info: null },
  agent_result: null,
  verifier_result: { rewards: { reward: 1 } },
  verifier_environment_mode: "shared",
  exception_info: null,
  started_at: "2026-07-28T09:00:00+00:00",
  finished_at: "2026-07-28T09:01:00+00:00",
  environment_setup: null,
  agent_setup: null,
  agent_execution: null,
  verifier: null,
  step_results: null,
};

it.effect("decodes a Harbor trial result", () =>
  Effect.gen(function* () {
    const result = yield* Schema.decodeUnknownEffect(TrailResult)(trail);

    assert.strictEqual(result.trial_name, "hello-world__abc1234");
    assert.strictEqual(result.verifier_result?.rewards?.reward, 1);
    if (result.started_at === null) {
      return assert.fail("Expected started_at to be decoded");
    }
    assert.isTrue(DateTime.isUtc(result.started_at));
  }),
);

it.effect("decodes a Harbor job result without embedded trials", () =>
  Effect.gen(function* () {
    const result = yield* Schema.decodeUnknownEffect(JobResult)({
      id: "6a0d6ef8-bfa8-48a8-a4d8-d774395956c5",
      started_at: "2026-07-28T09:00:00",
      updated_at: "2026-07-28T09:01:00",
      finished_at: null,
      n_total_trials: 1,
      stats: {
        n_completed_trials: 1,
        n_errored_trials: 0,
        n_running_trials: 0,
        n_pending_trials: 0,
        n_cancelled_trials: 0,
        n_retries: 0,
        evals: {},
        n_input_tokens: null,
        n_cache_tokens: null,
        n_output_tokens: null,
        cost_usd: null,
      },
    });

    assert.deepStrictEqual(result.trial_results, []);
    assert.strictEqual(result.stats.n_completed_trials, 1);
  }),
);
