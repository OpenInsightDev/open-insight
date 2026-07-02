import { type Draft, produce } from "immer";
import type { Event as ExecEvent } from "@open-insight/eval";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

type ScheduleStatus = "idle" | "running" | "paused" | "completed";

type InitEvent = Extract<ExecEvent, { _tag: "InitEvent" }>;
type BenchScheduleEvent = Extract<ExecEvent, { _tag: "BenchScheduleEvent" }>;
type TaskScheduleEvent = Extract<ExecEvent, { _tag: "TaskScheduleEvent" }>;
type MetricsStreamEvent = Extract<ExecEvent, { _tag: "MetricsStreamEvent" }>;
type TaskStreamPartEvent = Extract<ExecEvent, { _tag: "TaskStreamPartEvent" }>;

type BenchmarkMetadata = InitEvent["bench"];
type TaskMetadata = InitEvent["tasks"][number];
type MetricMetadata = InitEvent["metrics"][number];
type BenchmarkOutput = Extract<MetricsStreamEvent["output"], { _tag: "BenchmarkOutput" }>;
type TaskOutput = Extract<MetricsStreamEvent["output"], { _tag: "TaskOutput" }>;
type TrajOutput = Extract<MetricsStreamEvent["output"], { _tag: "TrajOutput" }>;

export type DashboardTrailState = {
  index: number;
  status: ScheduleStatus;
  parts: Array<unknown>;
  metrics: Record<string, unknown>;
};

export type DashboardTaskState = {
  metadata: TaskMetadata;
  status: ScheduleStatus;
  metrics: Record<string, unknown>;
  trails: Record<number, DashboardTrailState>;
};

export type DashboardBenchmarkState = {
  metadata: BenchmarkMetadata;
  status: ScheduleStatus;
  metrics: Record<string, unknown>;
  metricMetadata: Array<MetricMetadata>;
  tasks: Record<string, DashboardTaskState>;
};

export type DashboardPageState = {
  benchmark: DashboardBenchmarkState | null;
};

type DashboardStoreState = {
  page: DashboardPageState;
  reset: () => void;
  applyEvent: (event: ExecEvent) => void;
  applyEvents: (events: ReadonlyArray<ExecEvent>) => void;
};

const initialPageState = (): DashboardPageState => ({
  benchmark: null,
});

const toScheduleStatus = (op: BenchScheduleEvent["op"]): ScheduleStatus => {
  switch (op) {
    case "start":
      return "running";
    case "pause":
      return "paused";
    case "stop":
      return "completed";
  }
};

const createTaskState = (metadata: TaskMetadata): DashboardTaskState => ({
  metadata,
  status: "idle",
  metrics: {},
  trails: {},
});

const createTrailState = (trailIndex: number): DashboardTrailState => ({
  index: trailIndex,
  status: "idle",
  parts: [],
  metrics: {},
});

const createBenchmarkState = (event: InitEvent): DashboardBenchmarkState => ({
  metadata: event.bench,
  status: "idle",
  metrics: {},
  metricMetadata: [...event.metrics],
  tasks: Object.fromEntries(event.tasks.map((task) => [task.name, createTaskState(task)])),
});

const createPlaceholderBenchmarkState = (benchName: string): DashboardBenchmarkState => ({
  metadata: {
    name: benchName,
    description: "",
  },
  status: "idle",
  metrics: {},
  metricMetadata: [],
  tasks: {},
});

const createPlaceholderTaskState = (taskName: string): DashboardTaskState =>
  createTaskState({ name: taskName });

const ensureBenchmark = (
  page: Draft<DashboardPageState>,
  benchName: string,
): Draft<DashboardBenchmarkState> => {
  if (page.benchmark !== null && page.benchmark.metadata.name === benchName) {
    return page.benchmark;
  }

  const benchmark = createPlaceholderBenchmarkState(benchName);
  page.benchmark = benchmark;
  return benchmark;
};

const ensureTask = (
  benchmark: Draft<DashboardBenchmarkState>,
  taskName: string,
): Draft<DashboardTaskState> => {
  const existing = benchmark.tasks[taskName];
  if (existing) {
    return existing;
  }

  const task = createPlaceholderTaskState(taskName);
  benchmark.tasks[taskName] = task;
  return task;
};

const ensureTrail = (
  task: Draft<DashboardTaskState>,
  trailIndex: number,
): Draft<DashboardTrailState> => {
  const existing = task.trails[trailIndex];
  if (existing) {
    return existing;
  }

  const trail = createTrailState(trailIndex);
  task.trails[trailIndex] = trail;
  return trail;
};

const applyBenchmarkOutput = (
  benchmark: Draft<DashboardBenchmarkState>,
  output: BenchmarkOutput,
) => {
  benchmark.metrics[output.name] = output.result;
};

const applyTaskOutput = (benchmark: Draft<DashboardBenchmarkState>, output: TaskOutput) => {
  const task = ensureTask(benchmark, output.task.name);
  task.metadata = output.task;
  task.metrics[output.name] = output.result;
};

const applyTrajOutput = (benchmark: Draft<DashboardBenchmarkState>, output: TrajOutput) => {
  const task = ensureTask(benchmark, output.task.name);
  const trail = ensureTrail(task, output.trailIndex);

  task.metadata = output.task;
  trail.metrics[output.name] = output.result;
};

export const reduceDashboardEvent = (
  page: DashboardPageState,
  event: ExecEvent,
): DashboardPageState => {
  switch (event._tag) {
    case "InitEvent":
      return {
        benchmark: createBenchmarkState(event),
      };

    case "BenchScheduleEvent":
      return produce(page, (draft) => {
        const benchmark = ensureBenchmark(draft, event.bench);
        benchmark.status = toScheduleStatus(event.op);
      });

    case "TaskScheduleEvent":
      return produce(page, (draft) => {
        const benchmark = ensureBenchmark(draft, event.bench);
        const task = ensureTask(benchmark, event.task);

        task.status = toScheduleStatus(event.op);

        if (event.trailIndex !== undefined) {
          const trail = ensureTrail(task, event.trailIndex);
          trail.status = toScheduleStatus(event.op);
        }
      });

    case "MetricsStreamEvent":
      return produce(page, (draft) => {
        const benchmark = ensureBenchmark(draft, event.bench);

        switch (event.output._tag) {
          case "BenchmarkOutput":
            applyBenchmarkOutput(benchmark, event.output);
            break;

          case "TaskOutput":
            applyTaskOutput(benchmark, event.output);
            break;

          case "TrajOutput":
            applyTrajOutput(benchmark, event.output);
            break;
        }
      });

    case "TaskStreamPartEvent":
      return produce(page, (draft) => {
        const benchmark = ensureBenchmark(draft, event.bench);
        const task = ensureTask(benchmark, event.task);
        const trail = ensureTrail(task, event.trailIndex);

        if (task.status !== "completed") {
          task.status = "running";
        }

        if (trail.status !== "completed") {
          trail.status = "running";
        }

        trail.parts.push(...event.parts);
      });
  }
};

export const dashboardStore = createStore<DashboardStoreState>()((set) => ({
  page: initialPageState(),
  reset: () => {
    set({ page: initialPageState() });
  },
  applyEvent: (event) => {
    set((state) => ({
      page: reduceDashboardEvent(state.page, event),
    }));
  },
  applyEvents: (events) => {
    set((state) => ({
      page: events.reduce(reduceDashboardEvent, state.page),
    }));
  },
}));

export const getDashboardPageState = () => dashboardStore.getState().page;

export const useDashboardStore = <T>(selector: (state: DashboardStoreState) => T): T =>
  useStore(dashboardStore, selector);

export const useDashboardPageState = () => useDashboardStore((state) => state.page);
