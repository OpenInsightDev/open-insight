import type { Exec } from "@open-insight/eval";
import type { StreamingMessagePartEncoded } from "@/components/streaming-message/index.ts";
import { del, get, set } from "idb-keyval";
import { produce, type Draft } from "immer";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type Json = unknown;

export interface BenchmarkMetadata {
  name: string;
  description?: string;
  categories?: Array<string>;
  homepage?: string;
  registry?: string;
  authors?: Array<string>;
}

export interface TaskMetadata {
  name: string;
  description?: string;
  keywords?: Array<string>;
  authors?: Array<string>;
  extra?: Record<string, string>;
}

export type MetricScope = "Trajectory" | "Task" | "Benchmark";
export type MetricVariant = "Reduce" | "Each" | "All";

export interface MetricMetadata {
  name: string;
  type: MetricScope;
  variant: MetricVariant;
}

type EvalEvent = Exec.Event;

export type StreamPart = StreamingMessagePartEncoded;
export type TrailUsage = Extract<StreamPart, { type: "finish" }>["usage"];

type ScheduleOp = "start" | "stop" | "pause";

type BenchmarkMetricOutput = {
  _tag: "BenchmarkOutput";
  name: string;
  result: Json;
};

type TaskMetricOutput = {
  _tag: "TaskOutput";
  name: string;
  task: TaskMetadata;
  result: Json;
};

type TrajectoryMetricOutput = {
  _tag: "TrajOutput";
  name: string;
  task: TaskMetadata;
  trailIndex: number;
  result: Json;
};

type MetricOutput = BenchmarkMetricOutput | TaskMetricOutput | TrajectoryMetricOutput;

type InitEventView = EvalEvent & {
  _tag: "InitEvent";
  bench: BenchmarkMetadata;
  tasks: Array<TaskMetadata>;
  metrics: Array<MetricMetadata>;
};

type BenchScheduleEventView = EvalEvent & {
  _tag: "BenchScheduleEvent";
  bench: string;
  op: ScheduleOp;
};

type TaskScheduleEventView = EvalEvent & {
  _tag: "TaskScheduleEvent";
  bench: string;
  task: string;
  trailIndex?: number;
  op: ScheduleOp;
};

type MetricsStreamEventView = EvalEvent & {
  _tag: "MetricsStreamEvent";
  bench: string;
  output: MetricOutput;
};

type TaskStreamPartEventView = EvalEvent & {
  _tag: "TaskStreamPartEvent";
  bench: string;
  task: string;
  trailIndex: number;
  parts: Array<StreamPart>;
};

export type RunStatus = "idle" | "running" | "paused" | "completed" | "failed";

export interface MetricResult {
  metadata?: MetricMetadata;
  value: Json;
  updatedAt: number;
}

export type MetricResultByName = Partial<Record<string, MetricResult>>;
export type MetricMetadataByName = Partial<Record<string, MetricMetadata>>;
export type MetricMetadataByScope = {
  [Scope in MetricScope]: MetricMetadataByName;
};
export type MetricNamesByScope = {
  [Scope in MetricScope]: Array<string>;
};

export interface TrailNode {
  index: number;
  status: RunStatus;
  streamParts: Array<StreamPart>;
  metrics: MetricResultByName;
  usage?: TrailUsage;
  error?: unknown;
  startedAt?: number;
  finishedAt?: number;
  lastEventAt?: number;
}

export interface TaskProgress {
  observedTrails: number;
  idleTrails: number;
  runningTrails: number;
  pausedTrails: number;
  completedTrails: number;
  failedTrails: number;
}

export interface TaskNode {
  name: string;
  metadata?: TaskMetadata;
  status: RunStatus;
  metrics: MetricResultByName;
  trailsByIndex: Partial<Record<number, TrailNode>>;
  trailOrder: Array<number>;
  progress: TaskProgress;
  startedAt?: number;
  finishedAt?: number;
  lastEventAt?: number;
}

export interface BenchmarkProgress extends TaskProgress {
  totalTasks: number;
  idleTasks: number;
  runningTasks: number;
  pausedTasks: number;
  completedTasks: number;
  failedTasks: number;
}

export interface BenchmarkNode {
  name: string;
  metadata?: BenchmarkMetadata;
  status: RunStatus;
  metricMetadataByName: MetricMetadataByName;
  metricMetadataByScope: MetricMetadataByScope;
  metricNamesByScope: MetricNamesByScope;
  taskOrder: Array<string>;
  tasksByName: Partial<Record<string, TaskNode>>;
  metrics: MetricResultByName;
  progress: BenchmarkProgress;
  startedAt?: number;
  finishedAt?: number;
  lastEventAt?: number;
}

export interface DashboardSelection {
  benchmarkName?: string;
  taskName?: string;
  trailIndex?: number;
}

export interface DashboardDataState {
  benchmarksByName: Partial<Record<string, BenchmarkNode>>;
  benchmarkOrder: Array<string>;
  activeBenchmarkName?: string;
  selected: DashboardSelection;
  eventCount: number;
  lastEventAt?: number;
}

export interface DashboardStore extends DashboardDataState {
  applyEvent: (event: EvalEvent, receivedAt?: number) => void;
  applyEvents: (events: ReadonlyArray<EvalEvent>, receivedAt?: number) => void;
  reset: () => void;
  selectBenchmark: (benchmarkName: string | undefined) => void;
  selectTask: (benchmarkName: string | undefined, taskName: string | undefined) => void;
  selectTrail: (
    benchmarkName: string | undefined,
    taskName: string | undefined,
    trailIndex: number | undefined,
  ) => void;
}

type StatusStamped = {
  status: RunStatus;
  startedAt?: number;
  finishedAt?: number;
  lastEventAt?: number;
};
type DashboardDataDraft = Draft<DashboardDataState>;
type BenchmarkDraft = Draft<BenchmarkNode>;
type TaskDraft = Draft<TaskNode>;
type TrailDraft = Draft<TrailNode>;
type MetricResultByNameDraft = Draft<MetricResultByName>;
type StatusDraft = Draft<StatusStamped>;

const isDefined = <Value>(value: Value | undefined): value is Value => value !== undefined;

const makeTaskProgress = (): TaskProgress => ({
  observedTrails: 0,
  idleTrails: 0,
  runningTrails: 0,
  pausedTrails: 0,
  completedTrails: 0,
  failedTrails: 0,
});

const makeBenchmarkProgress = (): BenchmarkProgress => ({
  ...makeTaskProgress(),
  totalTasks: 0,
  idleTasks: 0,
  runningTasks: 0,
  pausedTasks: 0,
  completedTasks: 0,
  failedTasks: 0,
});

const makeMetricMetadataByScope = (): MetricMetadataByScope => ({
  Benchmark: {},
  Task: {},
  Trajectory: {},
});

const makeMetricNamesByScope = (): MetricNamesByScope => ({
  Benchmark: [],
  Task: [],
  Trajectory: [],
});

const makeBenchmarkNode = (
  name: string,
  timestamp: number,
  metadata?: BenchmarkMetadata,
): BenchmarkNode => ({
  name,
  metadata,
  status: "idle",
  metricMetadataByName: {},
  metricMetadataByScope: makeMetricMetadataByScope(),
  metricNamesByScope: makeMetricNamesByScope(),
  taskOrder: [],
  tasksByName: {},
  metrics: {},
  progress: makeBenchmarkProgress(),
  lastEventAt: timestamp,
});

const makeTaskNode = (name: string, timestamp: number, metadata?: TaskMetadata): TaskNode => ({
  name,
  metadata,
  status: "idle",
  metrics: {},
  trailsByIndex: {},
  trailOrder: [],
  progress: makeTaskProgress(),
  lastEventAt: timestamp,
});

const makeTrailNode = (index: number, timestamp: number): TrailNode => ({
  index,
  status: "idle",
  streamParts: [],
  metrics: {},
  lastEventAt: timestamp,
});

export const makeInitialDashboardState = (): DashboardDataState => ({
  benchmarksByName: {},
  benchmarkOrder: [],
  selected: {},
  eventCount: 0,
});

export const selectActiveBenchmark = (state: DashboardDataState): BenchmarkNode | undefined => {
  if (state.activeBenchmarkName === undefined) {
    return undefined;
  }

  return state.benchmarksByName[state.activeBenchmarkName];
};

export const selectBenchmarkTasks = (benchmark: BenchmarkNode | undefined): Array<TaskNode> => {
  if (benchmark === undefined) {
    return [];
  }

  return benchmark.taskOrder.map((taskName) => benchmark.tasksByName[taskName]).filter(isDefined);
};

export const selectTaskTrails = (task: TaskNode | undefined): Array<TrailNode> => {
  if (task === undefined) {
    return [];
  }

  return task.trailOrder.map((trailIndex) => task.trailsByIndex[trailIndex]).filter(isDefined);
};

export const selectMetricResults = (metrics: MetricResultByName): Array<MetricResult> =>
  Object.values(metrics).filter(isDefined);

const addBenchmarkName = (state: DashboardDataDraft, benchmarkName: string): void => {
  if (!state.benchmarkOrder.includes(benchmarkName)) {
    state.benchmarkOrder.push(benchmarkName);
  }
};

const addTaskName = (benchmark: BenchmarkDraft, taskName: string): void => {
  if (!benchmark.taskOrder.includes(taskName)) {
    benchmark.taskOrder.push(taskName);
  }
};

const addTrailIndex = (task: TaskDraft, trailIndex: number): void => {
  if (!task.trailOrder.includes(trailIndex)) {
    task.trailOrder.push(trailIndex);
    task.trailOrder.sort((left, right) => left - right);
  }
};

const ensureBenchmark = (
  state: DashboardDataDraft,
  benchmarkName: string,
  timestamp: number,
  metadata?: BenchmarkMetadata,
): BenchmarkDraft => {
  const existing = state.benchmarksByName[benchmarkName];

  if (existing !== undefined) {
    existing.metadata = metadata ?? existing.metadata;
    existing.lastEventAt = timestamp;
    addBenchmarkName(state, benchmarkName);
    state.activeBenchmarkName ??= benchmarkName;
    return existing;
  }

  const benchmark = makeBenchmarkNode(benchmarkName, timestamp, metadata);
  state.benchmarksByName[benchmarkName] = benchmark;
  addBenchmarkName(state, benchmarkName);
  state.activeBenchmarkName ??= benchmarkName;
  return benchmark;
};

const ensureTask = (
  benchmark: BenchmarkDraft,
  taskName: string,
  timestamp: number,
  metadata?: TaskMetadata,
): TaskDraft => {
  const existing = benchmark.tasksByName[taskName];

  if (existing !== undefined) {
    existing.metadata = metadata ?? existing.metadata;
    existing.lastEventAt = timestamp;
    addTaskName(benchmark, taskName);
    return existing;
  }

  const task = makeTaskNode(taskName, timestamp, metadata);
  benchmark.tasksByName[taskName] = task;
  addTaskName(benchmark, taskName);
  return task;
};

const ensureTrail = (task: TaskDraft, trailIndex: number, timestamp: number): TrailDraft => {
  const existing = task.trailsByIndex[trailIndex];

  if (existing !== undefined) {
    existing.lastEventAt = timestamp;
    addTrailIndex(task, trailIndex);
    return existing;
  }

  const trail = makeTrailNode(trailIndex, timestamp);
  task.trailsByIndex[trailIndex] = trail;
  addTrailIndex(task, trailIndex);
  return trail;
};

const setStatus = (target: StatusDraft, status: RunStatus, timestamp: number): void => {
  target.status = status;
  target.lastEventAt = timestamp;

  if (status === "running") {
    target.startedAt ??= timestamp;
    target.finishedAt = undefined;
    return;
  }

  if (status === "completed" || status === "failed") {
    target.startedAt ??= timestamp;
    target.finishedAt = timestamp;
  }
};

const markRunningIfOpen = (target: StatusDraft, timestamp: number): void => {
  if (target.status === "idle" || target.status === "paused") {
    setStatus(target, "running", timestamp);
  }
};

const scheduleStatus = (op: ScheduleOp): RunStatus => {
  switch (op) {
    case "start":
      return "running";
    case "pause":
      return "paused";
    case "stop":
      return "completed";
  }
};

const putMetric = (
  metrics: MetricResultByNameDraft,
  name: string,
  value: Json,
  metadata: MetricMetadata | undefined,
  timestamp: number,
): void => {
  metrics[name] = {
    metadata,
    value,
    updatedAt: timestamp,
  };
};

const addMetricMetadata = (benchmark: BenchmarkDraft, metadata: MetricMetadata): void => {
  benchmark.metricMetadataByName[metadata.name] = metadata;
  benchmark.metricMetadataByScope[metadata.type][metadata.name] = metadata;

  const names = benchmark.metricNamesByScope[metadata.type];
  if (!names.includes(metadata.name)) {
    names.push(metadata.name);
  }
};

const metricMetadataFor = (
  benchmark: BenchmarkDraft,
  scope: MetricScope,
  name: string,
): MetricMetadata | undefined =>
  benchmark.metricMetadataByScope[scope][name] ?? benchmark.metricMetadataByName[name];

const recomputeTaskProgress = (task: TaskDraft): void => {
  const trails = task.trailOrder
    .map((trailIndex) => task.trailsByIndex[trailIndex])
    .filter(isDefined);

  task.progress = {
    observedTrails: trails.length,
    idleTrails: trails.filter((trail) => trail.status === "idle").length,
    runningTrails: trails.filter((trail) => trail.status === "running").length,
    pausedTrails: trails.filter((trail) => trail.status === "paused").length,
    completedTrails: trails.filter((trail) => trail.status === "completed").length,
    failedTrails: trails.filter((trail) => trail.status === "failed").length,
  };
};

const recomputeBenchmarkProgress = (benchmark: BenchmarkDraft): void => {
  const tasks = benchmark.taskOrder
    .map((taskName) => benchmark.tasksByName[taskName])
    .filter(isDefined);

  benchmark.progress = {
    totalTasks: tasks.length,
    idleTasks: tasks.filter((task) => task.status === "idle").length,
    runningTasks: tasks.filter((task) => task.status === "running").length,
    pausedTasks: tasks.filter((task) => task.status === "paused").length,
    completedTasks: tasks.filter((task) => task.status === "completed").length,
    failedTasks: tasks.filter((task) => task.status === "failed").length,
    observedTrails: tasks.reduce((total, task) => total + task.progress.observedTrails, 0),
    idleTrails: tasks.reduce((total, task) => total + task.progress.idleTrails, 0),
    runningTrails: tasks.reduce((total, task) => total + task.progress.runningTrails, 0),
    pausedTrails: tasks.reduce((total, task) => total + task.progress.pausedTrails, 0),
    completedTrails: tasks.reduce((total, task) => total + task.progress.completedTrails, 0),
    failedTrails: tasks.reduce((total, task) => total + task.progress.failedTrails, 0),
  };
};

const resetBenchmarkFromInit = (
  state: DashboardDataDraft,
  event: InitEventView,
  timestamp: number,
): BenchmarkDraft => {
  const benchmark = makeBenchmarkNode(event.bench.name, timestamp, event.bench);
  state.benchmarksByName[event.bench.name] = benchmark;
  addBenchmarkName(state, event.bench.name);

  for (const metadata of event.metrics) {
    addMetricMetadata(benchmark, metadata);
  }

  for (const metadata of event.tasks) {
    ensureTask(benchmark, metadata.name, timestamp, metadata);
  }

  state.activeBenchmarkName = event.bench.name;
  state.selected.benchmarkName = event.bench.name;

  const selectedTaskExists =
    state.selected.taskName !== undefined &&
    benchmark.tasksByName[state.selected.taskName] !== undefined;

  if (!selectedTaskExists) {
    state.selected.taskName = event.tasks[0]?.name;
    state.selected.trailIndex = undefined;
  }

  recomputeBenchmarkProgress(benchmark);
  return benchmark;
};

const applyMetricsStreamEvent = (
  state: DashboardDataDraft,
  event: MetricsStreamEventView,
  timestamp: number,
): void => {
  const benchmark = ensureBenchmark(state, event.bench, timestamp);
  const output = event.output;

  switch (output._tag) {
    case "BenchmarkOutput":
      putMetric(
        benchmark.metrics,
        output.name,
        output.result,
        metricMetadataFor(benchmark, "Benchmark", output.name),
        timestamp,
      );
      break;
    case "TaskOutput": {
      const task = ensureTask(benchmark, output.task.name, timestamp, output.task);
      putMetric(
        task.metrics,
        output.name,
        output.result,
        metricMetadataFor(benchmark, "Task", output.name),
        timestamp,
      );
      recomputeTaskProgress(task);
      break;
    }
    case "TrajOutput": {
      const task = ensureTask(benchmark, output.task.name, timestamp, output.task);
      const trail = ensureTrail(task, output.trailIndex, timestamp);
      putMetric(
        trail.metrics,
        output.name,
        output.result,
        metricMetadataFor(benchmark, "Trajectory", output.name),
        timestamp,
      );
      recomputeTaskProgress(task);
      break;
    }
  }

  recomputeBenchmarkProgress(benchmark);
};

const applyStreamPart = (trail: TrailDraft, part: StreamPart, timestamp: number): void => {
  switch (part.type) {
    case "finish":
      trail.usage = part.usage;
      if (part.reason === "error") {
        setStatus(trail, "failed", timestamp);
        return;
      }
      if (part.reason === "pause") {
        setStatus(trail, "paused", timestamp);
        return;
      }
      setStatus(trail, "completed", timestamp);
      return;
    case "error":
      trail.error = part.error;
      setStatus(trail, "failed", timestamp);
      return;
  }
};

const applyTaskStreamPartEvent = (
  state: DashboardDataDraft,
  event: TaskStreamPartEventView,
  timestamp: number,
): void => {
  const benchmark = ensureBenchmark(state, event.bench, timestamp);
  const task = ensureTask(benchmark, event.task, timestamp);
  const trail = ensureTrail(task, event.trailIndex, timestamp);

  markRunningIfOpen(benchmark, timestamp);
  markRunningIfOpen(task, timestamp);
  markRunningIfOpen(trail, timestamp);

  for (const part of event.parts) {
    trail.streamParts.push(part);
    applyStreamPart(trail, part, timestamp);
  }

  recomputeTaskProgress(task);
  recomputeBenchmarkProgress(benchmark);
};

const applyTaskScheduleEvent = (
  state: DashboardDataDraft,
  event: TaskScheduleEventView,
  timestamp: number,
): void => {
  const benchmark = ensureBenchmark(state, event.bench, timestamp);
  const task = ensureTask(benchmark, event.task, timestamp);
  const nextStatus = scheduleStatus(event.op);

  if (event.trailIndex === undefined) {
    setStatus(task, nextStatus, timestamp);
  } else {
    const trail = ensureTrail(task, event.trailIndex, timestamp);
    if (nextStatus === "running") {
      markRunningIfOpen(task, timestamp);
    }
    setStatus(trail, nextStatus, timestamp);
  }

  recomputeTaskProgress(task);
  recomputeBenchmarkProgress(benchmark);
};

const isInitEvent = (event: EvalEvent): event is InitEventView => event._tag === "InitEvent";

const isBenchScheduleEvent = (event: EvalEvent): event is BenchScheduleEventView =>
  event._tag === "BenchScheduleEvent";

const isTaskScheduleEvent = (event: EvalEvent): event is TaskScheduleEventView =>
  event._tag === "TaskScheduleEvent";

const isMetricsStreamEvent = (event: EvalEvent): event is MetricsStreamEventView =>
  event._tag === "MetricsStreamEvent";

const isTaskStreamPartEvent = (event: EvalEvent): event is TaskStreamPartEventView =>
  event._tag === "TaskStreamPartEvent";

export const reduceEvent = (
  state: DashboardDataState,
  event: EvalEvent,
  receivedAt = Date.now(),
): DashboardDataState =>
  produce(state, (draft) => {
    draft.eventCount += 1;
    draft.lastEventAt = receivedAt;

    if (isInitEvent(event)) {
      resetBenchmarkFromInit(draft, event, receivedAt);
      return;
    }

    if (isBenchScheduleEvent(event)) {
      const benchmark = ensureBenchmark(draft, event.bench, receivedAt);
      setStatus(benchmark, scheduleStatus(event.op), receivedAt);
      recomputeBenchmarkProgress(benchmark);
      return;
    }

    if (isTaskScheduleEvent(event)) {
      applyTaskScheduleEvent(draft, event, receivedAt);
      return;
    }

    if (isMetricsStreamEvent(event)) {
      applyMetricsStreamEvent(draft, event, receivedAt);
      return;
    }

    if (isTaskStreamPartEvent(event)) {
      applyTaskStreamPartEvent(draft, event, receivedAt);
    }
  });

const storage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const value = await get<string>(name);
    return value ?? null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await set(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name);
  },
};

export const useStore = create<DashboardStore>()(
  persist(
    (setState) => ({
      ...makeInitialDashboardState(),
      applyEvent: (event, receivedAt = Date.now()) =>
        setState((state) => reduceEvent(state, event, receivedAt)),
      applyEvents: (events, receivedAt = Date.now()) => {
        if (events.length === 0) {
          return;
        }

        setState((state) => {
          let nextState: DashboardDataState = state;
          for (const event of events) {
            nextState = reduceEvent(nextState, event, receivedAt);
          }
          return nextState;
        });
      },
      reset: () => setState(makeInitialDashboardState()),
      selectBenchmark: (benchmarkName) =>
        setState({
          activeBenchmarkName: benchmarkName,
          selected: {
            benchmarkName,
          },
        }),
      selectTask: (benchmarkName, taskName) =>
        setState({
          activeBenchmarkName: benchmarkName,
          selected: {
            benchmarkName,
            taskName,
          },
        }),
      selectTrail: (benchmarkName, taskName, trailIndex) =>
        setState({
          activeBenchmarkName: benchmarkName,
          selected: {
            benchmarkName,
            taskName,
            trailIndex,
          },
        }),
    }),
    {
      name: "dashboard-storage",
      version: 1,
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({
        benchmarksByName: state.benchmarksByName,
        benchmarkOrder: state.benchmarkOrder,
        activeBenchmarkName: state.activeBenchmarkName,
        selected: state.selected,
        eventCount: state.eventCount,
        lastEventAt: state.lastEventAt,
      }),
    },
  ),
);
