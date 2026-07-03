import { useState, type ReactNode } from "react";
import type { Metric } from "@open-insight/eval";
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ErrorBar,
  FunnelChart,
  Funnel,
  LabelList,
  LineChart,
  Line,
  PieChart,
  Pie,
  PolarAngleAxis,
  PolarGrid,
  RadarChart,
  Radar,
  Sankey,
  ScatterChart,
  Scatter,
  Treemap,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import "./App.css";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart.tsx";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
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

type ChartType = Metric.Type;
type DashboardTab = "tasks" | "charts" | "benchmark";

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

const chartTypeCoverage: Record<ChartType, true> = {
  Bar: true,
  GroupedBar: true,
  Pie: true,
  Line: true,
  Series: true,
  Scatter: true,
  Radar: true,
  Heatmap: true,
  Treemap: true,
  SankeyLink: true,
  Funnel: true,
  WordCloud: true,
  BoxPlot: true,
  Candlestick: true,
  Gauge: true,
  Content: true,
};

const baseChartConfig = {
  value: { label: "Value", color: "var(--chart-1)" },
  secondary: { label: "Secondary", color: "var(--chart-2)" },
  warning: { label: "Warning", color: "var(--chart-3)" },
  critical: { label: "Critical", color: "var(--chart-4)" },
  detail: { label: "Detail", color: "var(--chart-5)" },
} satisfies ChartConfig;

const groupedBarConfig = {
  baseline: { label: "Baseline", color: "var(--chart-2)" },
  current: { label: "Current", color: "var(--chart-1)" },
  target: { label: "Target", color: "var(--chart-3)" },
} satisfies ChartConfig;

const seriesConfig = {
  accuracy: { label: "Accuracy", color: "var(--chart-1)" },
  latency: { label: "Latency", color: "var(--chart-4)" },
  tokens: { label: "Tokens", color: "var(--chart-2)" },
} satisfies ChartConfig;

const barData = [
  { category: "Research", value: 86 },
  { category: "Patch", value: 94 },
  { category: "Triage", value: 48 },
  { category: "Review", value: 72 },
  { category: "Report", value: 81 },
];

const groupedBarData = [
  { category: "Plan", baseline: 63, current: 79, target: 84 },
  { category: "Act", baseline: 58, current: 76, target: 82 },
  { category: "Verify", baseline: 46, current: 68, target: 80 },
  { category: "Cite", baseline: 71, current: 84, target: 88 },
];

const pieData = [
  { name: "Completed", value: 38, fill: "var(--chart-2)" },
  { name: "Running", value: 12, fill: "var(--chart-1)" },
  { name: "Failed", value: 8, fill: "var(--chart-4)" },
  { name: "Queued", value: 15, fill: "var(--chart-3)" },
];

const lineData = [
  { x: "09:00", y: 0.58 },
  { x: "09:30", y: 0.66 },
  { x: "10:00", y: 0.69 },
  { x: "10:30", y: 0.74 },
  { x: "11:00", y: 0.79 },
  { x: "11:30", y: 0.76 },
];

const seriesData = [
  { x: "Run 1", accuracy: 62, latency: 84, tokens: 42 },
  { x: "Run 2", accuracy: 68, latency: 71, tokens: 49 },
  { x: "Run 3", accuracy: 73, latency: 64, tokens: 55 },
  { x: "Run 4", accuracy: 79, latency: 59, tokens: 61 },
  { x: "Run 5", accuracy: 82, latency: 53, tokens: 67 },
];

const scatterData = [
  { x: 42, y: 0.66, size: 360, label: "research" },
  { x: 58, y: 0.94, size: 520, label: "patch" },
  { x: 73, y: 0.71, size: 420, label: "review" },
  { x: 96, y: 0.31, size: 680, label: "triage" },
  { x: 64, y: 0.82, size: 460, label: "report" },
];

const radarData = [
  { category: "Planning", value: 84 },
  { category: "Evidence", value: 76 },
  { category: "Tool use", value: 88 },
  { category: "Recovery", value: 55 },
  { category: "Output", value: 79 },
  { category: "Speed", value: 68 },
];

const heatmapData = [
  { x: 1, y: 1, value: 42 },
  { x: 2, y: 1, value: 66 },
  { x: 3, y: 1, value: 81 },
  { x: 4, y: 1, value: 71 },
  { x: 1, y: 2, value: 58 },
  { x: 2, y: 2, value: 74 },
  { x: 3, y: 2, value: 89 },
  { x: 4, y: 2, value: 63 },
  { x: 1, y: 3, value: 35 },
  { x: 2, y: 3, value: 52 },
  { x: 3, y: 3, value: 68 },
  { x: 4, y: 3, value: 47 },
];

const treemapData = [
  { name: "Evidence", value: 34 },
  { name: "Tool calls", value: 28 },
  { name: "Reasoning", value: 24 },
  { name: "Outputs", value: 18 },
  { name: "Errors", value: 10 },
  { name: "Usage", value: 14 },
];

const sankeyData = {
  nodes: [
    { name: "Queued" },
    { name: "Running" },
    { name: "Completed" },
    { name: "Failed" },
    { name: "Review" },
  ],
  links: [
    { source: 0, target: 1, value: 42 },
    { source: 1, target: 2, value: 28 },
    { source: 1, target: 3, value: 7 },
    { source: 1, target: 4, value: 7 },
    { source: 4, target: 2, value: 5 },
    { source: 4, target: 3, value: 2 },
  ],
};

const funnelData = [
  { name: "Tasks loaded", value: 120, fill: "var(--chart-1)" },
  { name: "Trails started", value: 92, fill: "var(--chart-2)" },
  { name: "Evidence found", value: 74, fill: "var(--chart-3)" },
  { name: "Passed", value: 53, fill: "var(--chart-4)" },
];

const wordCloudData = [
  { x: 18, y: 68, value: 880, text: "citation" },
  { x: 38, y: 44, value: 620, text: "retry" },
  { x: 58, y: 72, value: 720, text: "tool" },
  { x: 76, y: 36, value: 520, text: "latency" },
  { x: 48, y: 26, value: 450, text: "schema" },
  { x: 26, y: 22, value: 340, text: "evidence" },
];

const boxPlotData = [
  { label: "Research", value: [63, 86], range: [48, 96], median: 76 },
  { label: "Patch", value: [72, 94], range: [58, 99], median: 88 },
  { label: "Triage", value: [31, 57], range: [18, 79], median: 44 },
  { label: "Review", value: [54, 82], range: [37, 90], median: 69 },
];

const candlestickData = [
  { time: "09:00", value: [52, 68], range: [44, 74], close: 68 },
  { time: "09:30", value: [68, 61], range: [55, 72], close: 61 },
  { time: "10:00", value: [61, 77], range: [57, 83], close: 77 },
  { time: "10:30", value: [77, 73], range: [66, 81], close: 73 },
  { time: "11:00", value: [73, 86], range: [71, 91], close: 86 },
];

const gaugeData = [
  { name: "Score", value: 74, fill: "var(--chart-1)" },
  { name: "Remaining", value: 26, fill: "var(--muted)" },
];

const contentValue = {
  runId: "bench-agent-042",
  verdict: "needs review",
  evidence: ["official-source", "tool-log", "trajectory"],
  notes: "Failure cluster is isolated to timeout-sensitive tasks.",
};

function App() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("charts");
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
    <TooltipProvider>
      <main className="dashboard-shell">
        <DashboardHeader benchmark={benchmark} eventCount={128} lastEventAt={mockUpdatedAt} />

        <Tabs
          value={activeTab}
          onValueChange={(nextValue) => {
            if (nextValue === "tasks" || nextValue === "charts" || nextValue === "benchmark") {
              setActiveTab(nextValue);
            }
          }}
          className="dashboard-section-tabs"
        >
          <TabsList className="dashboard-tabs-list" variant="line" aria-label="Dashboard sections">
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="charts">Charts</TabsTrigger>
            <TabsTrigger value="benchmark">Benchmark Stats</TabsTrigger>
          </TabsList>
        </Tabs>

        {activeTab === "benchmark" ? (
          <BenchmarkStats benchmark={benchmark} />
        ) : activeTab === "charts" ? (
          <ChartGallery />
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
    </TooltipProvider>
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

function ChartGallery() {
  return (
    <section className="chart-gallery">
      <div className="chart-gallery-header">
        <div>
          <h2>Metric Chart Types</h2>
          <p>
            Mock metric outputs rendered from every chart type exposed by the eval metric schema.
          </p>
        </div>
        <Badge variant="secondary">{Object.keys(chartTypeCoverage).length} chart types</Badge>
      </div>

      <div className="chart-card-grid">
        <ChartShowcaseCard
          type="Bar"
          title="Task Score"
          description="Single category-value metric shape for task-level comparisons."
        >
          <ChartContainer config={baseChartConfig} className="chart-visual">
            <BarChart accessibilityLayer data={barData} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="category" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={30} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={4} />
            </BarChart>
          </ChartContainer>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="GroupedBar"
          title="Baseline vs Current"
          description="Category, group, and value mapped into grouped metric bars."
        >
          <ChartContainer config={groupedBarConfig} className="chart-visual">
            <BarChart accessibilityLayer data={groupedBarData} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="category" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={30} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="baseline" fill="var(--color-baseline)" radius={3} />
              <Bar dataKey="current" fill="var(--color-current)" radius={3} />
              <Bar dataKey="target" fill="var(--color-target)" radius={3} />
            </BarChart>
          </ChartContainer>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="Pie"
          title="Run State Share"
          description="Name-value metric distribution for benchmark state."
        >
          <ChartContainer config={baseChartConfig} className="chart-visual">
            <PieChart accessibilityLayer>
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius={48}
                outerRadius={84}
                paddingAngle={2}
              >
                {pieData.map((item) => (
                  <Cell key={item.name} fill={item.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="Line"
          title="Score Trend"
          description="String x-axis and numeric y-axis across a running benchmark window."
        >
          <ChartContainer config={baseChartConfig} className="chart-visual">
            <LineChart accessibilityLayer data={lineData} margin={{ left: 0, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="x" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={32} domain={[0.4, 1]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                type="monotone"
                dataKey="y"
                stroke="var(--color-value)"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ChartContainer>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="Series"
          title="Multi-signal Series"
          description="Series, x, and y values pivoted into aligned metric traces."
        >
          <ChartContainer config={seriesConfig} className="chart-visual">
            <LineChart accessibilityLayer data={seriesData} margin={{ left: 0, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="x" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={30} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Line dataKey="accuracy" stroke="var(--color-accuracy)" strokeWidth={2} />
              <Line dataKey="latency" stroke="var(--color-latency)" strokeWidth={2} />
              <Line dataKey="tokens" stroke="var(--color-tokens)" strokeWidth={2} />
            </LineChart>
          </ChartContainer>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="Scatter"
          title="Latency vs Accuracy"
          description="Numeric x/y values with optional size and label metadata."
        >
          <ChartContainer config={baseChartConfig} className="chart-visual">
            <ScatterChart accessibilityLayer margin={{ left: 0, right: 14, top: 10 }}>
              <CartesianGrid />
              <XAxis dataKey="x" name="Latency" unit="ms" tickLine={false} axisLine={false} />
              <YAxis
                dataKey="y"
                name="Accuracy"
                tickLine={false}
                axisLine={false}
                width={34}
                domain={[0.2, 1]}
              />
              <ZAxis dataKey="size" range={[80, 460]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Scatter data={scatterData} fill="var(--color-value)" />
            </ScatterChart>
          </ChartContainer>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="Radar"
          title="Capability Profile"
          description="Category, metric, and value projected around one benchmark profile."
        >
          <ChartContainer config={baseChartConfig} className="chart-visual">
            <RadarChart accessibilityLayer data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="category" />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Radar
                dataKey="value"
                fill="var(--color-value)"
                fillOpacity={0.24}
                stroke="var(--color-value)"
                strokeWidth={2}
              />
            </RadarChart>
          </ChartContainer>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="Heatmap"
          title="Task x Signal Density"
          description="Heatmap schema rendered as a Recharts bubble matrix."
        >
          <ChartContainer config={baseChartConfig} className="chart-visual">
            <ScatterChart accessibilityLayer margin={{ left: 4, right: 16, top: 12, bottom: 4 }}>
              <CartesianGrid />
              <XAxis dataKey="x" type="number" domain={[0.5, 4.5]} tickLine={false} />
              <YAxis dataKey="y" type="number" domain={[0.5, 3.5]} tickLine={false} width={28} />
              <ZAxis dataKey="value" range={[80, 760]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Scatter data={heatmapData} fill="var(--color-warning)" />
            </ScatterChart>
          </ChartContainer>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="Treemap"
          title="Evidence Volume"
          description="Name-value leaves grouped by benchmark evidence categories."
        >
          <ChartContainer config={baseChartConfig} className="chart-visual">
            <Treemap
              data={treemapData}
              dataKey="value"
              nameKey="name"
              stroke="var(--background)"
              fill="var(--color-value)"
              aspectRatio={1.45}
            />
          </ChartContainer>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="SankeyLink"
          title="Execution Flow"
          description="Source, target, and value links across benchmark run states."
        >
          <ChartContainer config={baseChartConfig} className="chart-visual">
            <Sankey
              data={sankeyData}
              dataKey="value"
              node={{ fill: "var(--color-value)", stroke: "var(--background)", strokeWidth: 1 }}
              link={{ stroke: "var(--color-secondary)", strokeOpacity: 0.35 }}
              margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
            >
              <ChartTooltip content={<ChartTooltipContent />} />
            </Sankey>
          </ChartContainer>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="Funnel"
          title="Evaluation Funnel"
          description="Name-value funnel from loaded tasks to passing outcomes."
        >
          <ChartContainer config={baseChartConfig} className="chart-visual">
            <FunnelChart accessibilityLayer>
              <ChartTooltip content={<ChartTooltipContent />} />
              <Funnel data={funnelData} dataKey="value" nameKey="name" isAnimationActive>
                <LabelList dataKey="name" position="right" fill="var(--foreground)" />
              </Funnel>
            </FunnelChart>
          </ChartContainer>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="WordCloud"
          title="Signal Terms"
          description="Text and value represented as weighted labeled bubbles."
        >
          <ChartContainer config={baseChartConfig} className="chart-visual">
            <ScatterChart accessibilityLayer margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
              <XAxis dataKey="x" type="number" domain={[0, 100]} hide />
              <YAxis dataKey="y" type="number" domain={[0, 100]} hide />
              <ZAxis dataKey="value" range={[180, 980]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Scatter data={wordCloudData} fill="var(--color-detail)">
                <LabelList dataKey="text" position="center" fill="var(--background)" />
              </Scatter>
            </ScatterChart>
          </ChartContainer>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="BoxPlot"
          title="Score Distribution"
          description="Label and value samples summarized into interquartile ranges."
        >
          <ChartContainer config={baseChartConfig} className="chart-visual">
            <ComposedChart accessibilityLayer data={boxPlotData} margin={{ left: 0, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={30} domain={[0, 100]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={3} barSize={22}>
                <ErrorBar dataKey="range" width={8} stroke="var(--color-critical)" />
              </Bar>
              <Line
                dataKey="median"
                stroke="var(--color-critical)"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ChartContainer>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="Candlestick"
          title="Run Score Movement"
          description="Time and value samples rendered as ranged open-close bars."
        >
          <ChartContainer config={baseChartConfig} className="chart-visual">
            <ComposedChart
              accessibilityLayer
              data={candlestickData}
              margin={{ left: 0, right: 12 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis dataKey="time" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={30} domain={[40, 95]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="value" fill="var(--color-secondary)" radius={3} barSize={18}>
                <ErrorBar dataKey="range" width={7} stroke="var(--color-value)" />
              </Bar>
              <Line dataKey="close" stroke="var(--color-value)" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ChartContainer>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="Gauge"
          title="Overall Score"
          description="Name and value rendered as a compact benchmark gauge."
        >
          <ChartContainer config={baseChartConfig} className="chart-visual gauge-visual">
            <PieChart accessibilityLayer>
              <Pie
                data={gaugeData}
                dataKey="value"
                nameKey="name"
                startAngle={180}
                endAngle={0}
                innerRadius={70}
                outerRadius={94}
                paddingAngle={1}
              >
                {gaugeData.map((item) => (
                  <Cell key={item.name} fill={item.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="gauge-readout">
            <strong>74%</strong>
            <span>weighted benchmark score</span>
          </div>
        </ChartShowcaseCard>

        <ChartShowcaseCard
          type="Content"
          title="Structured Content"
          description="Arbitrary JSON content shown beside summary evidence."
          footer="Content is intentionally not coerced into numeric axes."
        >
          <div className="content-chart">
            <pre>{formatJson(contentValue)}</pre>
            <div className="content-evidence">
              <Badge variant="outline">official-source</Badge>
              <Badge variant="outline">tool-log</Badge>
              <Badge variant="outline">trajectory</Badge>
            </div>
          </div>
        </ChartShowcaseCard>
      </div>
    </section>
  );
}

function ChartShowcaseCard({
  type,
  title,
  description,
  footer,
  children,
}: {
  type: ChartType;
  title: string;
  description: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <Card className="chart-card" size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge variant="outline">{type}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="chart-card-content">{children}</CardContent>
      {footer === undefined ? null : (
        <CardFooter className="chart-card-footer">{footer}</CardFooter>
      )}
    </Card>
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
