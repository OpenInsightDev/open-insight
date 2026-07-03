import { useState, type ReactNode } from "react";
import "./App.css";
import {
  selectBenchmarkTasks,
  selectTaskTrails,
  type BenchmarkNode,
  type MetricScope,
  type MetricResult,
  type MetricResultByName,
  type MetricMetadata,
  type RunStatus,
  type TaskNode,
  type TrailNode,
} from "./store";

type DashboardTab = "tasks" | "benchmark";

type MetricEntry = {
  name: string;
  metric: MetricResult;
};

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const numberFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

const percentFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  style: "percent",
});

const metricScopes: ReadonlyArray<MetricScope> = ["Benchmark", "Task", "Trajectory"];

const mockStartedAt = Date.now() - 1000 * 60 * 42;
const mockUpdatedAt = Date.now() - 1000 * 60 * 3;

const mockBenchmarkMetrics: ReadonlyArray<MetricMetadata> = [
  { name: "overall_score", type: "Benchmark", variant: "Reduce" },
  { name: "pass_rate", type: "Benchmark", variant: "Reduce" },
  { name: "task_score", type: "Task", variant: "Each" },
  { name: "tool_success", type: "Task", variant: "Reduce" },
  { name: "accuracy", type: "Trajectory", variant: "Each" },
  { name: "latency_ms", type: "Trajectory", variant: "Each" },
  { name: "tokens", type: "Trajectory", variant: "Each" },
];

const mockBenchmark: BenchmarkNode = {
  name: "Agent Workflow Benchmark",
  metadata: {
    name: "Agent Workflow Benchmark",
    description:
      "Evaluates agent research, code modification, and bug triage workflows across task results, trajectory metrics, and execution messages.",
    categories: ["agent", "tool-use", "reasoning"],
    homepage: "https://open-insight.local/benchmarks/agent-workflow",
    registry: "open-insight/mock",
    authors: ["Open Insight"],
  },
  status: "running",
  metricMetadataByName: Object.fromEntries(
    mockBenchmarkMetrics.map((metric) => [metric.name, metric]),
  ),
  metricMetadataByScope: {
    Benchmark: {
      overall_score: mockBenchmarkMetrics[0],
      pass_rate: mockBenchmarkMetrics[1],
    },
    Task: {
      task_score: mockBenchmarkMetrics[2],
      tool_success: mockBenchmarkMetrics[3],
    },
    Trajectory: {
      accuracy: mockBenchmarkMetrics[4],
      latency_ms: mockBenchmarkMetrics[5],
      tokens: mockBenchmarkMetrics[6],
    },
  },
  metricNamesByScope: {
    Benchmark: ["overall_score", "pass_rate"],
    Task: ["task_score", "tool_success"],
    Trajectory: ["accuracy", "latency_ms", "tokens"],
  },
  taskOrder: ["web_research", "code_patch", "bug_triage"],
  tasksByName: {
    web_research: {
      name: "web_research",
      metadata: {
        name: "Web Research",
        description: "Find current facts, compare sources, and return a cited synthesis.",
        keywords: ["search", "citation", "synthesis"],
        authors: ["Eval Team"],
        extra: {
          difficulty: "medium",
          domain: "research",
        },
      },
      status: "running",
      metrics: {
        task_score: {
          metadata: mockBenchmarkMetrics[2],
          value: 0.78,
          updatedAt: mockUpdatedAt,
        },
        tool_success: {
          metadata: mockBenchmarkMetrics[3],
          value: 0.92,
          updatedAt: mockUpdatedAt,
        },
      },
      trailsByIndex: {
        0: {
          index: 0,
          status: "completed",
          streamParts: [
            {
              type: "reasoning-delta",
              delta: "Identify primary sources and freshness requirements.",
            },
            { type: "text-delta", delta: "Found official docs and two release notes." },
            { type: "finish", reason: "stop" },
          ],
          textPreview:
            "Found official docs and two release notes. The recommended answer cites the primary source first, then adds release-note context.",
          reasoningPreview: "Identify primary sources and freshness requirements.",
          metrics: {
            accuracy: {
              metadata: mockBenchmarkMetrics[4],
              value: 0.86,
              updatedAt: mockUpdatedAt,
            },
            latency_ms: {
              metadata: mockBenchmarkMetrics[5],
              value: 72,
              updatedAt: mockUpdatedAt,
            },
            tokens: {
              metadata: mockBenchmarkMetrics[6],
              value: 1840,
              updatedAt: mockUpdatedAt,
            },
          },
          startedAt: mockStartedAt,
          finishedAt: mockUpdatedAt,
          lastEventAt: mockUpdatedAt,
        },
        1: {
          index: 1,
          status: "running",
          streamParts: [
            { type: "reasoning-delta", delta: "Check whether the policy changed recently." },
            { type: "text-delta", delta: "Reading the latest changelog and comparing dates." },
          ],
          textPreview: "Reading the latest changelog and comparing dates.",
          reasoningPreview: "Check whether the policy changed recently.",
          metrics: {
            accuracy: {
              metadata: mockBenchmarkMetrics[4],
              value: 0.63,
              updatedAt: mockUpdatedAt,
            },
            latency_ms: {
              metadata: mockBenchmarkMetrics[5],
              value: 44,
              updatedAt: mockUpdatedAt,
            },
          },
          startedAt: mockStartedAt + 1000 * 60 * 12,
          lastEventAt: mockUpdatedAt,
        },
      },
      trailOrder: [0, 1],
      progress: {
        observedTrails: 2,
        idleTrails: 0,
        runningTrails: 1,
        pausedTrails: 0,
        completedTrails: 1,
        failedTrails: 0,
      },
      startedAt: mockStartedAt,
      lastEventAt: mockUpdatedAt,
    },
    code_patch: {
      name: "code_patch",
      metadata: {
        name: "Code Patch",
        description: "Modify a local app, preserve project conventions, and verify the result.",
        keywords: ["typescript", "react", "validation"],
        authors: ["Eval Team"],
      },
      status: "completed",
      metrics: {
        task_score: {
          metadata: mockBenchmarkMetrics[2],
          value: 0.91,
          updatedAt: mockUpdatedAt,
        },
        tool_success: {
          metadata: mockBenchmarkMetrics[3],
          value: 1,
          updatedAt: mockUpdatedAt,
        },
      },
      trailsByIndex: {
        0: {
          index: 0,
          status: "completed",
          streamParts: [
            { type: "reasoning-delta", delta: "Read store types and existing app shell." },
            { type: "text-delta", delta: "Implemented the dashboard layout and ran checks." },
            { type: "finish", reason: "stop" },
          ],
          textPreview: "Implemented the dashboard layout and ran checks.",
          reasoningPreview: "Read store types and existing app shell.",
          metrics: {
            accuracy: {
              metadata: mockBenchmarkMetrics[4],
              value: 0.94,
              updatedAt: mockUpdatedAt,
            },
            latency_ms: {
              metadata: mockBenchmarkMetrics[5],
              value: 58,
              updatedAt: mockUpdatedAt,
            },
            tokens: {
              metadata: mockBenchmarkMetrics[6],
              value: 2412,
              updatedAt: mockUpdatedAt,
            },
          },
          startedAt: mockStartedAt + 1000 * 60 * 6,
          finishedAt: mockUpdatedAt - 1000 * 60 * 5,
          lastEventAt: mockUpdatedAt,
        },
      },
      trailOrder: [0],
      progress: {
        observedTrails: 1,
        idleTrails: 0,
        runningTrails: 0,
        pausedTrails: 0,
        completedTrails: 1,
        failedTrails: 0,
      },
      startedAt: mockStartedAt + 1000 * 60 * 6,
      finishedAt: mockUpdatedAt - 1000 * 60 * 5,
      lastEventAt: mockUpdatedAt,
    },
    bug_triage: {
      name: "bug_triage",
      metadata: {
        name: "Bug Triage",
        description: "Inspect a failing scenario, classify risk, and identify the smallest fix.",
        keywords: ["debugging", "risk", "repro"],
        authors: ["Eval Team"],
      },
      status: "failed",
      metrics: {
        task_score: {
          metadata: mockBenchmarkMetrics[2],
          value: 0.38,
          updatedAt: mockUpdatedAt,
        },
      },
      trailsByIndex: {
        0: {
          index: 0,
          status: "failed",
          streamParts: [
            { type: "reasoning-delta", delta: "Reproduce the failure from the report." },
            { type: "error", error: "Fixture timed out before the failing state was captured." },
          ],
          textPreview: "",
          reasoningPreview: "Reproduce the failure from the report.",
          metrics: {
            accuracy: {
              metadata: mockBenchmarkMetrics[4],
              value: 0.31,
              updatedAt: mockUpdatedAt,
            },
            latency_ms: {
              metadata: mockBenchmarkMetrics[5],
              value: 96,
              updatedAt: mockUpdatedAt,
            },
          },
          error: "Fixture timed out before the failing state was captured.",
          startedAt: mockStartedAt + 1000 * 60 * 18,
          finishedAt: mockUpdatedAt - 1000 * 60,
          lastEventAt: mockUpdatedAt,
        },
      },
      trailOrder: [0],
      progress: {
        observedTrails: 1,
        idleTrails: 0,
        runningTrails: 0,
        pausedTrails: 0,
        completedTrails: 0,
        failedTrails: 1,
      },
      startedAt: mockStartedAt + 1000 * 60 * 18,
      finishedAt: mockUpdatedAt - 1000 * 60,
      lastEventAt: mockUpdatedAt,
    },
  },
  metrics: {
    overall_score: {
      metadata: mockBenchmarkMetrics[0],
      value: 0.74,
      updatedAt: mockUpdatedAt,
    },
    pass_rate: {
      metadata: mockBenchmarkMetrics[1],
      value: 0.67,
      updatedAt: mockUpdatedAt,
    },
  },
  progress: {
    totalTasks: 3,
    idleTasks: 0,
    runningTasks: 1,
    pausedTasks: 0,
    completedTasks: 1,
    failedTasks: 1,
    observedTrails: 4,
    idleTrails: 0,
    runningTrails: 1,
    pausedTrails: 0,
    completedTrails: 2,
    failedTrails: 1,
  },
  startedAt: mockStartedAt,
  lastEventAt: mockUpdatedAt,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const metricEntries = (metrics: MetricResultByName): Array<MetricEntry> =>
  Object.entries(metrics).flatMap(([name, metric]) =>
    metric === undefined ? [] : [{ name, metric }],
  );

const formatTimestamp = (timestamp: number | undefined): string =>
  timestamp === undefined ? "none" : dateTimeFormat.format(new Date(timestamp));

const formatJson = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return numberFormat.format(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  const serialized = JSON.stringify(value, null, 2);
  return serialized ?? "undefined";
};

const formatMetricValue = (value: unknown): string => {
  const numericValue = numericMetricValue(value);

  if (numericValue !== undefined) {
    return numericValue >= 0 && numericValue <= 1
      ? percentFormat.format(numericValue)
      : numberFormat.format(numericValue);
  }

  return formatJson(value);
};

const numericMetricValue = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of ["score", "accuracy", "rate", "value", "total", "count"]) {
    const nestedValue = value[key];
    if (typeof nestedValue === "number" && Number.isFinite(nestedValue)) {
      return nestedValue;
    }
  }

  for (const nestedValue of Object.values(value)) {
    if (typeof nestedValue === "number" && Number.isFinite(nestedValue)) {
      return nestedValue;
    }
  }

  return undefined;
};

const metricBarWidth = (value: unknown): string => {
  const numericValue = numericMetricValue(value);

  if (numericValue === undefined) {
    return "18%";
  }

  if (numericValue >= 0 && numericValue <= 1) {
    return `${Math.max(4, numericValue * 100)}%`;
  }

  return `${Math.max(4, Math.min(100, numericValue))}%`;
};

const streamPartType = (part: unknown): string => {
  if (!isRecord(part) || typeof part.type !== "string") {
    return "part";
  }

  return part.type;
};

const streamPartBody = (part: unknown): string => {
  if (!isRecord(part)) {
    return formatJson(part);
  }

  if (typeof part.delta === "string") {
    return part.delta;
  }

  if (typeof part.reason === "string") {
    return `reason: ${part.reason}`;
  }

  if (part.error !== undefined) {
    return formatJson(part.error);
  }

  return formatJson(part);
};

const progressItems = (progress: BenchmarkNode["progress"]) => [
  { label: "Tasks", value: progress.totalTasks },
  { label: "Running", value: progress.runningTasks },
  { label: "Done", value: progress.completedTasks },
  { label: "Failed", value: progress.failedTasks },
  { label: "Trails", value: progress.observedTrails },
  { label: "Trail done", value: progress.completedTrails },
];

const taskProgressItems = (task: TaskNode) => [
  { label: "Trails", value: task.progress.observedTrails },
  { label: "Idle", value: task.progress.idleTrails },
  { label: "Running", value: task.progress.runningTrails },
  { label: "Paused", value: task.progress.pausedTrails },
  { label: "Done", value: task.progress.completedTrails },
  { label: "Failed", value: task.progress.failedTrails },
];

function App() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("tasks");
  const [activeTaskName, setActiveTaskName] = useState(mockBenchmark.taskOrder[0] ?? "");
  const [activeTrailIndex, setActiveTrailIndex] = useState<number | undefined>(undefined);

  const benchmark = mockBenchmark;
  const tasks = selectBenchmarkTasks(benchmark);
  const selectedTask = benchmark.tasksByName[activeTaskName];
  const task = selectedTask ?? tasks[0];
  const taskName = task?.name;
  const trails = selectTaskTrails(task);
  const selectedTrail =
    activeTrailIndex === undefined ? undefined : task?.trailsByIndex[activeTrailIndex];
  const trail = selectedTrail ?? trails[0];
  const trailIndex = trail?.index;

  return (
    <main className="dashboard-shell">
      <DashboardHeader benchmark={benchmark} eventCount={128} lastEventAt={mockUpdatedAt} />

      <nav className="dashboard-tabs" aria-label="Dashboard sections">
        <button
          type="button"
          className={activeTab === "tasks" ? "is-active" : undefined}
          onClick={() => setActiveTab("tasks")}
        >
          Tasks
        </button>
        <button
          type="button"
          className={activeTab === "benchmark" ? "is-active" : undefined}
          onClick={() => setActiveTab("benchmark")}
        >
          Benchmark Stats
        </button>
      </nav>

      {activeTab === "benchmark" ? (
        <BenchmarkStats benchmark={benchmark} />
      ) : (
        <section className="tasks-layout">
          <TaskRail
            benchmark={benchmark}
            tasks={tasks}
            activeTaskName={taskName}
            onSelectTask={(nextTaskName) => {
              setActiveTaskName(nextTaskName);
              setActiveTrailIndex(undefined);
            }}
          />
          <section className="task-workspace">
            <TaskStats task={task} />
            <TrailPanel
              benchmarkName={benchmark.name}
              taskName={task?.name}
              trails={trails}
              activeTrailIndex={trailIndex}
              trail={trail}
              onSelectTrail={setActiveTrailIndex}
            />
          </section>
        </section>
      )}
    </main>
  );
}

function DashboardHeader({
  benchmark,
  eventCount,
  lastEventAt,
}: {
  benchmark: BenchmarkNode | undefined;
  eventCount: number;
  lastEventAt: number | undefined;
}) {
  const metadata = benchmark?.metadata;
  const title = metadata?.name ?? benchmark?.name ?? "Benchmark";

  return (
    <header className="dashboard-header">
      <div className="title-block">
        <p className="eyebrow">Benchmark</p>
        <h1>{title}</h1>
        {metadata?.description !== undefined ? (
          <p className="benchmark-description">{metadata.description}</p>
        ) : null}
      </div>
      <div className="header-meta">
        <StatusPill status={benchmark?.status ?? "idle"} />
        <span>{eventCount} events</span>
        <span>Last {formatTimestamp(lastEventAt)}</span>
      </div>
    </header>
  );
}

function BenchmarkStats({ benchmark }: { benchmark: BenchmarkNode }) {
  const benchmarkMetrics = metricEntries(benchmark.metrics);
  const metadata = benchmark.metadata;

  return (
    <section className="benchmark-grid">
      <Panel title="Progress">
        <StatGrid items={progressItems(benchmark.progress)} />
      </Panel>

      <Panel title="Benchmark Metrics">
        <MetricGrid metrics={benchmarkMetrics} emptyLabel="No benchmark metrics yet" />
      </Panel>

      <Panel title="Metric Registry">
        <div className="registry-grid">
          {metricScopes.map((scope) => (
            <div className="registry-column" key={scope}>
              <h3>{scope}</h3>
              {benchmark.metricNamesByScope[scope].length === 0 ? (
                <p className="muted">none</p>
              ) : (
                <ul className="plain-list">
                  {benchmark.metricNamesByScope[scope].map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Metadata">
        <dl className="metadata-list">
          <KeyValue label="Name" value={metadata?.name ?? benchmark.name} />
          <KeyValue label="Homepage" value={metadata?.homepage} />
          <KeyValue label="Registry" value={metadata?.registry} />
          <KeyValue label="Categories" value={metadata?.categories?.join(", ")} />
          <KeyValue label="Authors" value={metadata?.authors?.join(", ")} />
          <KeyValue label="Started" value={formatTimestamp(benchmark.startedAt)} />
          <KeyValue label="Finished" value={formatTimestamp(benchmark.finishedAt)} />
        </dl>
      </Panel>
    </section>
  );
}

function TaskRail({
  benchmark,
  tasks,
  activeTaskName,
  onSelectTask,
}: {
  benchmark: BenchmarkNode;
  tasks: Array<TaskNode>;
  activeTaskName: string | undefined;
  onSelectTask: (taskName: string) => void;
}) {
  return (
    <aside className="task-rail" aria-label="Tasks">
      <div className="rail-heading">
        <span>Tasks</span>
        <span>{benchmark.progress.totalTasks}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="empty-inline">No tasks</p>
      ) : (
        tasks.map((task) => (
          <button
            type="button"
            key={task.name}
            className={task.name === activeTaskName ? "task-tab is-active" : "task-tab"}
            onClick={() => onSelectTask(task.name)}
          >
            <span className="task-name">{task.metadata?.name ?? task.name}</span>
            <span className="task-subline">
              {task.progress.completedTrails}/{task.progress.observedTrails} trails
            </span>
            <StatusPill status={task.status} compact />
          </button>
        ))
      )}
    </aside>
  );
}

function TaskStats({ task }: { task: TaskNode | undefined }) {
  if (task === undefined) {
    return (
      <Panel title="Task Stats">
        <p className="empty-inline">No task selected</p>
      </Panel>
    );
  }

  return (
    <Panel title="Task Stats" aside={<StatusPill status={task.status} />}>
      <div className="task-stats-grid">
        <div className="task-main-column">
          <StatGrid items={taskProgressItems(task)} />
          <MetricGrid metrics={metricEntries(task.metrics)} emptyLabel="No task metrics yet" />
        </div>
        <div className="task-metadata">
          <dl className="metadata-list">
            <KeyValue label="Name" value={task.metadata?.name ?? task.name} />
            <KeyValue label="Keywords" value={task.metadata?.keywords?.join(", ")} />
            <KeyValue label="Authors" value={task.metadata?.authors?.join(", ")} />
            <KeyValue label="Started" value={formatTimestamp(task.startedAt)} />
            <KeyValue label="Finished" value={formatTimestamp(task.finishedAt)} />
          </dl>
          {task.metadata?.description !== undefined ? (
            <p className="task-description">{task.metadata.description}</p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function TrailPanel({
  benchmarkName,
  taskName,
  trails,
  activeTrailIndex,
  trail,
  onSelectTrail,
}: {
  benchmarkName: string;
  taskName: string | undefined;
  trails: Array<TrailNode>;
  activeTrailIndex: number | undefined;
  trail: TrailNode | undefined;
  onSelectTrail: (trailIndex: number) => void;
}) {
  return (
    <Panel
      title="Trail"
      aside={trail === undefined ? undefined : <StatusPill status={trail.status} />}
    >
      <div className="trail-tabs" aria-label="Trails">
        {trails.length === 0 ? (
          <p className="empty-inline">No trails</p>
        ) : (
          trails.map((item) => (
            <button
              type="button"
              key={item.index}
              className={item.index === activeTrailIndex ? "is-active" : undefined}
              onClick={() => onSelectTrail(item.index)}
            >
              #{item.index}
            </button>
          ))
        )}
      </div>

      {trail === undefined ? (
        <p className="empty-inline">No trail selected</p>
      ) : (
        <div className="trail-grid">
          <section className="trail-metrics">
            <div className="section-heading">
              <h3>Metrics</h3>
              <span>{metricEntries(trail.metrics).length}</span>
            </div>
            <MetricGrid
              metrics={metricEntries(trail.metrics)}
              emptyLabel="No trajectory metrics yet"
              compact
            />
            <TrailUsage trail={trail} />
          </section>

          <section className="message-panel">
            <div className="section-heading">
              <h3>Agent Workflow</h3>
              <span>
                {benchmarkName} / {taskName ?? "task"} / #{trail.index}
              </span>
            </div>
            <MessageFlow trail={trail} />
          </section>
        </div>
      )}
    </Panel>
  );
}

function TrailUsage({ trail }: { trail: TrailNode }) {
  if (trail.usage === undefined && trail.error === undefined) {
    return null;
  }

  return (
    <div className="usage-grid">
      {trail.usage === undefined ? null : <pre className="json-box">{formatJson(trail.usage)}</pre>}
      {trail.error === undefined ? null : (
        <pre className="json-box error-box">{formatJson(trail.error)}</pre>
      )}
    </div>
  );
}

function MessageFlow({ trail }: { trail: TrailNode }) {
  return (
    <div className="message-flow">
      {trail.reasoningPreview.length > 0 ? (
        <article className="message-item">
          <div className="message-meta">reasoning</div>
          <p>{trail.reasoningPreview}</p>
        </article>
      ) : null}
      {trail.textPreview.length > 0 ? (
        <article className="message-item">
          <div className="message-meta">output</div>
          <p>{trail.textPreview}</p>
        </article>
      ) : null}
      {trail.streamParts.length === 0 ? (
        <p className="empty-inline">No stream parts</p>
      ) : (
        trail.streamParts.map((part, index) => (
          <article className="message-item is-compact" key={`${streamPartType(part)}-${index}`}>
            <div className="message-meta">
              {index + 1}. {streamPartType(part)}
            </div>
            <p>{streamPartBody(part)}</p>
          </article>
        ))
      )}
    </div>
  );
}

function MetricGrid({
  metrics,
  emptyLabel,
  compact = false,
}: {
  metrics: Array<MetricEntry>;
  emptyLabel: string;
  compact?: boolean;
}) {
  if (metrics.length === 0) {
    return <p className="empty-inline">{emptyLabel}</p>;
  }

  return (
    <div className={compact ? "metric-grid compact" : "metric-grid"}>
      {metrics.map(({ name, metric }) => (
        <article className="metric-card" key={name}>
          <div className="metric-topline">
            <span>{metric.metadata?.name ?? name}</span>
            <span>{metric.metadata?.variant ?? "Metric"}</span>
          </div>
          <strong>{formatMetricValue(metric.value)}</strong>
          <div className="mini-chart" aria-hidden="true">
            <span style={{ width: metricBarWidth(metric.value) }} />
          </div>
          <time>{formatTimestamp(metric.updatedAt)}</time>
        </article>
      ))}
    </div>
  );
}

function StatGrid({ items }: { items: Array<{ label: string; value: number }> }) {
  return (
    <div className="stat-grid">
      {items.map((item) => (
        <div className="stat-cell" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        {aside}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: string | undefined }) {
  if (value === undefined || value.length === 0) {
    return null;
  }

  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StatusPill({ status, compact = false }: { status: RunStatus; compact?: boolean }) {
  return (
    <span
      className={compact ? `status-pill compact status-${status}` : `status-pill status-${status}`}
    >
      {status}
    </span>
  );
}

export default App;
