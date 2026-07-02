import { describe, expect, it } from "vite-plus/test";

import { reduceDashboardEvent, type DashboardPageState } from "#/lib/dashboard-state";
import type { Event as ExecEvent } from "@open-insight/eval";

const initialState = (): DashboardPageState => ({
  benchmark: null,
});

describe("reduceDashboardEvent", () => {
  it("builds benchmark -> task -> trail state from exec events", () => {
    const events: ReadonlyArray<ExecEvent> = [
      {
        _tag: "InitEvent",
        bench: {
          name: "bench-1",
          description: "Demo benchmark",
        },
        tasks: [
          {
            name: "task-1",
            description: "Demo task",
          },
        ],
        metrics: [
          {
            name: "pass@1",
            type: "Task",
            variant: "Reduce",
          },
        ],
      },
      {
        _tag: "BenchScheduleEvent",
        bench: "bench-1",
        op: "start",
      },
      {
        _tag: "TaskScheduleEvent",
        bench: "bench-1",
        task: "task-1",
        trailIndex: 0,
        op: "start",
      },
      {
        _tag: "TaskStreamPartEvent",
        bench: "bench-1",
        task: "task-1",
        trailIndex: 0,
        parts: [{ type: "text-delta", textDelta: "hello" }],
      },
      {
        _tag: "MetricsStreamEvent",
        bench: "bench-1",
        output: {
          _tag: "TrajOutput",
          name: "score",
          task: {
            name: "task-1",
            description: "Demo task",
          },
          trailIndex: 0,
          result: 1,
        },
      },
      {
        _tag: "MetricsStreamEvent",
        bench: "bench-1",
        output: {
          _tag: "TaskOutput",
          name: "pass@1",
          task: {
            name: "task-1",
            description: "Demo task",
          },
          result: true,
        },
      },
      {
        _tag: "MetricsStreamEvent",
        bench: "bench-1",
        output: {
          _tag: "BenchmarkOutput",
          name: "overall",
          result: 0.5,
        },
      },
      {
        _tag: "TaskScheduleEvent",
        bench: "bench-1",
        task: "task-1",
        trailIndex: 0,
        op: "stop",
      },
      {
        _tag: "BenchScheduleEvent",
        bench: "bench-1",
        op: "stop",
      },
    ];

    const state = events.reduce(reduceDashboardEvent, initialState());

    expect(state.benchmark?.metadata.name).toBe("bench-1");
    expect(state.benchmark?.status).toBe("completed");
    expect(state.benchmark?.metrics.overall).toBe(0.5);
    expect(state.benchmark?.tasks["task-1"]?.metrics["pass@1"]).toBe(true);
    expect(state.benchmark?.tasks["task-1"]?.trails[0]?.status).toBe("completed");
    expect(state.benchmark?.tasks["task-1"]?.trails[0]?.metrics.score).toBe(1);
    expect(state.benchmark?.tasks["task-1"]?.trails[0]?.parts).toHaveLength(1);
  });
});
