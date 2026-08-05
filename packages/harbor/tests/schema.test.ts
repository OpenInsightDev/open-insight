import { Schema } from "effect";
import { expect, test } from "vite-plus/test";
import {
  AgentInfo,
  ContentPart,
  DatasetFileInfo,
  DatasetFileRef,
  DatasetManifest,
  DatasetMetadata,
  DatasetSpec,
  DatasetSummary,
  GitTaskId,
  hasMultimodalContent,
  JobConfig,
  JobResult,
  LocalTaskId,
  PackageReference,
  Registry,
  RegistryTaskId,
  RemoteRegistryInfo,
  RefType,
  TaskConfig,
  TaskId,
  Trajectory,
  TrialConfig,
  TrialTaskConfig,
  TrialResult,
  validateTag,
  VersionRef,
} from "../src/export.ts";

const id = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-08-01T00:00:00.000Z";

test("TaskConfig decodes the Harbor defaults", () => {
  const config = Schema.decodeUnknownSync(TaskConfig)({});

  expect(config.schema_version).toBe("1.4");
  expect(config.metadata).toEqual({});
  expect(config.environment.network_mode).toBe("public");
  expect(config.environment.os).toBe("linux");
  expect(config.verifier.timeout_sec).toBe(600);
  expect(config.solution.env).toEqual({});
  expect(config.artifacts).toEqual([]);
});

test("JobConfig and TrialConfig decode nested defaults", () => {
  const job = Schema.decodeUnknownSync(JobConfig)({});
  const trial = Schema.decodeUnknownSync(TrialConfig)({ task: { path: "hello" } });
  const jobWithTask = Schema.decodeUnknownSync(JobConfig)({
    tasks: [{ path: "hello" }],
  });

  expect(job.n_concurrent_trials).toBe(4);
  expect(job.agents).toHaveLength(1);
  expect(job.agents[0].resume_trajectory).toBe(false);
  expect(job.retry.max_wait_sec).toBe(60);
  expect(jobWithTask.tasks[0]).toBeInstanceOf(TrialTaskConfig);
  expect(trial.trials_dir).toBe("trials");
  expect(trial.agent.skills).toEqual([]);
  expect(trial.environment.delete).toBe(true);
});

test("environment variables retain their string-only contract", () => {
  expect(() =>
    Schema.decodeUnknownSync(TrialConfig)({
      task: { path: "hello" },
      agent: { env: { API_KEY: 42 } },
    }),
  ).toThrow();
});

test("TaskId selects the Git variant and validates UUIDs", () => {
  const taskId = Schema.decodeUnknownSync(TaskId)({
    git_url: "https://example.com/tasks.git",
    git_commit_id: "abc123",
    path: "hello-world",
  });

  expect(taskId).toBeInstanceOf(GitTaskId);
  if (taskId instanceof GitTaskId) {
    expect(taskId.git_url).toBe("https://example.com/tasks.git");
  }

  expect(() =>
    Schema.decodeUnknownSync(TrialResult)({
      id: "not-a-uuid",
      task_name: "hello",
      trial_name: "hello__trial",
      trial_uri: "file:///tmp/trial",
      task_id: { path: "hello" },
      task_checksum: "sha256:abc",
      config: { task: { path: "hello" } },
      agent_info: { name: "oracle", version: "1" },
    }),
  ).toThrow();
});

test("TrialResult and JobResult decode their persisted JSON shape", () => {
  const trial = Schema.decodeUnknownSync(TrialResult)({
    id,
    task_name: "hello",
    trial_name: "hello__trial",
    trial_uri: "file:///tmp/trial",
    task_id: { path: "hello" },
    source: null,
    task_checksum: "sha256:abc",
    config: { task: { path: "hello" } },
    agent_info: {
      name: "oracle",
      version: "1.0.0",
      model_info: { name: "gpt-5", provider: "openai" },
    },
    agent_result: { n_input_tokens: 12, n_output_tokens: 7 },
    verifier_result: { rewards: { reward: 1 } },
    started_at: timestamp,
  });

  const job = Schema.decodeUnknownSync(JobResult)({
    id,
    started_at: timestamp,
    n_total_trials: 1,
    stats: {
      evals: {
        oracle__adhoc: {
          n_trials: 1,
          reward_stats: { reward: { "1": ["hello__trial"] } },
        },
      },
    },
    trial_results: [Schema.encodeUnknownSync(TrialResult)(trial)],
  });

  expect(trial).toBeInstanceOf(TrialResult);
  expect(trial.started_at).toBeInstanceOf(Date);
  expect(trial.agent_info).toBeInstanceOf(AgentInfo);
  expect(job).toBeInstanceOf(JobResult);
  expect(job.stats.n_pending_trials).toBe(0);
  expect(job.trial_results[0].trial_name).toBe("hello__trial");
});

test("ATIF trajectories decode defaults and multimodal content", () => {
  const trajectory = Schema.decodeUnknownSync(Trajectory)({
    agent: { name: "harbor-agent", version: "1.0.0" },
    steps: [
      { step_id: 1, source: "user", message: "Inspect this image" },
      {
        step_id: 2,
        source: "agent",
        message: [
          { type: "text", text: "I will inspect it" },
          {
            type: "image",
            source: { media_type: "image/png", path: "images/screenshot.png" },
          },
        ],
        tool_calls: [
          {
            tool_call_id: "call-1",
            function_name: "inspect",
            arguments: { path: "images/screenshot.png" },
          },
        ],
        observation: {
          results: [{ source_call_id: "call-1", content: "Looks valid" }],
        },
      },
    ],
  });

  expect(trajectory.schema_version).toBe("ATIF-v1.7");
  expect(trajectory.agent.name).toBe("harbor-agent");
  expect(trajectory.steps[1].message[1]).toBeInstanceOf(ContentPart);
  expect(hasMultimodalContent(trajectory)).toBe(true);
});

test("ATIF trajectory checks reject invalid cross-field references", () => {
  expect(() =>
    Schema.decodeUnknownSync(Trajectory)({
      agent: { name: "agent", version: "1" },
      steps: [
        { step_id: 1, source: "user", message: "hello" },
        { step_id: 3, source: "agent", message: "done" },
      ],
    }),
  ).toThrow();

  expect(() =>
    Schema.decodeUnknownSync(Trajectory)({
      agent: { name: "agent", version: "1" },
      steps: [
        {
          step_id: 1,
          source: "agent",
          message: "run",
          observation: { results: [{ source_call_id: "missing" }] },
        },
      ],
    }),
  ).toThrow();

  expect(() =>
    Schema.decodeUnknownSync(Trajectory)({
      agent: { name: "agent", version: "1" },
      steps: [
        {
          step_id: 1,
          source: "agent",
          message: "dispatch",
          llm_call_count: 0,
          reasoning_content: "must not be present",
        },
      ],
    }),
  ).toThrow();
});

test("ATIF content parts and embedded trajectory references are validated", () => {
  expect(() =>
    Schema.decodeUnknownSync(ContentPart)({
      type: "text",
      source: { media_type: "image/png", path: "a.png" },
    }),
  ).toThrow();

  const subagent = {
    trajectory_id: "sub-1",
    agent: { name: "worker", version: "1" },
    steps: [{ step_id: 1, source: "agent", message: "done" }],
  };
  const parent = Schema.decodeUnknownSync(Trajectory)({
    agent: { name: "parent", version: "1" },
    steps: [{ step_id: 1, source: "user", message: "delegate" }],
    subagent_trajectories: [subagent],
  });

  expect(parent.subagent_trajectories?.[0].trajectory_id).toBe("sub-1");
  expect(() =>
    Schema.decodeUnknownSync(Trajectory)({
      agent: { name: "parent", version: "1" },
      steps: [{ step_id: 1, source: "user", message: "delegate" }],
      subagent_trajectories: [subagent, subagent],
    }),
  ).toThrow();
});

test("DatasetManifest decodes metadata defaults and validates content references", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const manifest = Schema.decodeUnknownSync(DatasetManifest)({
    dataset: {
      name: "org/example",
      version: "release-candidate",
      authors: [{ name: "Author" }],
    },
    tasks: [{ name: "org/task", digest }],
    files: [{ path: "metric.py" }],
  });

  expect(manifest.schema_version).toBe("1.0");
  expect(manifest.dataset.description).toBe("");
  expect(manifest.dataset.authors[0].name).toBe("Author");
  expect(manifest.tasks[0].toPackageReference().ref).toBe(digest);
  expect(manifest.tasks[0].org).toBe("org");
  expect(manifest.files[0].digest).toBe("");

  expect(() =>
    Schema.decodeUnknownSync(DatasetManifest)({
      dataset: { name: "org/../dataset" },
    }),
  ).toThrow();
  expect(() => Schema.decodeUnknownSync(DatasetFileRef)({ path: "nested/metric.py" })).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(DatasetManifest)({
      dataset: { name: "org/example", version: "" },
      tasks: [{ name: "org/task", digest: "sha256:bad" }],
    }),
  ).toThrow();
});

test("PackageReference parses tags, revisions, and digests", () => {
  const latest = Schema.decodeUnknownSync(PackageReference)({ name: "org/task" });
  const revision = PackageReference.parse("org/task@3");
  const digest = PackageReference.parse(`org/task@sha256:${"b".repeat(12)}`);

  expect(latest.ref).toBe("latest");
  expect(latest.parsed_ref).toBeInstanceOf(VersionRef);
  expect(Schema.decodeUnknownSync(RefType)(revision.parsed_ref.type)).toBe("revision");
  expect(revision.parsed_ref.revision).toBe(3);
  expect(digest.parsed_ref.type).toBe("digest");
  expect(PackageReference.parse("org/task").short_name).toBe("task");
  expect(validateTag("release-candidate")).toBe("release-candidate");
  expect(() => validateTag("3")).toThrow();
});

test("Registry models decode summaries and enforce their source", () => {
  const registry = Schema.decodeUnknownSync(Registry)({
    path: "registry.json",
    datasets: [
      {
        name: "example",
        version: "1.0",
        description: "Example dataset",
        tasks: [{ name: "task", path: "tasks/task" }],
      },
    ],
  });
  const sourceTask = registry.datasets[0].tasks[0].toSourceTaskId();
  const metadata = Schema.decodeUnknownSync(DatasetMetadata)({
    name: "example",
    task_ids: [{ path: "tasks/task" }],
  });
  const summary = Schema.decodeUnknownSync(DatasetSummary)({
    name: "example",
    task_count: 1,
  });
  const file = Schema.decodeUnknownSync(DatasetFileInfo)({
    path: "metric.py",
    storage_path: "datasets/example/metric.py",
    content_hash: "sha256:abc",
  });
  const remote = Schema.decodeUnknownSync(RemoteRegistryInfo)({});
  const spec = Schema.decodeUnknownSync(DatasetSpec)({
    name: "example",
    version: "1.0",
    description: "Example dataset",
    tasks: [],
  });

  expect(sourceTask).toBeInstanceOf(LocalTaskId);
  expect(metadata.task_ids[0]).toBeInstanceOf(LocalTaskId);
  expect(summary.description).toBe("");
  expect(file.storage_path).toContain("datasets/example");
  expect(remote.url).toContain("raw.githubusercontent.com");
  expect(spec.metrics).toEqual([]);
  expect(() =>
    Schema.decodeUnknownSync(Registry)({
      datasets: [],
    }),
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(Registry)({
      url: "https://example.com/registry.json",
      path: "registry.json",
      datasets: [],
    }),
  ).toThrow();
  expect(() => Schema.decodeUnknownSync(RegistryTaskId)({ path: "tasks/task" })).toThrow();
});
