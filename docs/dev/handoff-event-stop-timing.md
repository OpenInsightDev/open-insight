# Handoff: Schedule stop events fire at scope close, not at the actual stop moment

## Status

Open — diagnosed, not yet fixed. Observation reproduced on 2026-08-05 against `packages/eval` with the `Transport.Console` transport (single task, `Prob001_zero`).

## TL;DR

`EvalScheduleEvent` and `TaskScheduleEvent` stop events are emitted via `Effect.acquireRelease` releases, which are **scope finalizers** that run when the whole schedule's scope closes — i.e. at the very end of the eval run. They therefore do not reflect the actual moment the eval/task stopped, and all task stop events burst at the end of the event stream, after `BenchMetricEvent`. `TrailScheduleEvent` is correct: it uses `acquireUseRelease`, whose release fires immediately after the trail completes.

## Observed event order (single task, one trail)

```
InitEvent
EvalScheduleEvent  start
TaskScheduleEvent  start
TrailScheduleEvent start
TrailStreamEvent   …        (agent parts)
TrajMetricEvent    …        (incremental, per completed tool call — expected)
TrailStagedEvent            (grade)
TaskMetricEvent             (pass@k)
TrailScheduleEvent stop     ← correct: right after the trail
BenchMetricEvent
TaskScheduleEvent  stop     ← wrong: task stopped long ago, event only now
EvalScheduleEvent  stop     ← wrong: emitted via scope finalizer ordering
```

The last two stop events arrive only because the scope closes. `BenchMetricEvent` — computed per completed trail inside `Stream.runForEach` — is observed *between* the trail stop and the task stop, which inverts the actual timeline.

## Root cause

In `packages/eval/src/eval/schedule.ts`:

- `prepareTask` (lines 79–87) brackets `TaskScheduleEvent start/stop` with `Effect.acquireRelease`. `Effect.acquireRelease` registers the release as a **scope finalizer**; it runs when the surrounding scope closes. The whole schedule run is wrapped in `Effect.scoped` (line 256), so the release fires at the end of the entire eval, not when the task finishes.
- The main `run` (lines 173–181) brackets `EvalScheduleEvent start/stop` with `Effect.acquireRelease` for the same reason — timing is tied to finalizer ordering (LIFO: task stops then eval stop) rather than the actual completion point.
- `runScheduledTrail` (lines 120–131) is the *correct* pattern: `Effect.acquireUseRelease` runs the release immediately after `use` (the trail) completes.

Additional structural note: the task lifecycle spans `prepareTask` (which only prepares the trail runner) **plus** the trail executions in `makeTrailStream`/`completedTrails` (lines 145–191). The task stop must therefore fire after the task's *last* trail completes, which is in the aggregation loop (line 199), not inside `prepareTask`.

## Impact

- A live consumer (SSE transport, Parquet persistence, dashboard) cannot tell when a task actually completed: every task looks "running" until the whole eval ends.
- With `snapshotConcurrency > 1`, all task stop events arrive in one burst at the end, in finalizer order, instead of interleaving with the real completions.
- The eval stop event's position in the stream is incidental (depends on scope finalizer LIFO ordering and any future scope changes) rather than a deliberate emission point.

## Expected behavior

- `TrailScheduleEvent stop`: unchanged — fires when the trail completes.
- `TaskScheduleEvent stop`: fires when the task's last trail completes (after its `TrailScheduleEvent stop` / `TaskMetricEvent`), not at eval end.
- `EvalScheduleEvent stop`: fires when the eval run actually finishes (after all tasks and bench metrics), emitted deliberately rather than via finalizer ordering.

## Proposed fix

Two coupled changes in `packages/eval/src/eval/schedule.ts`:

1. **Task stop at real completion.** Track per-task completed-trail counts in the `completedTrails` aggregation (line 199, where `BenchMetricEvent` is already offered per trail). When a task's completed-trail count reaches `config.trailCount`, offer `TaskScheduleEvent stop` (lines 86–89 payload, moved from the `acquireRelease`). Keep the `start` offer in `prepareTask`; drop the `acquireRelease` wrapper for the stop (or convert it to a plain `offer(start)`).
2. **Eval stop at real completion.** Replace the `acquireRelease` (lines 173–181) with an explicit `offer(start)` at the top and `offer(stop)` at the end of `run`, guarded with `Effect.ensuring` (or `Effect.onExit`) so the stop still fires on failure/interruption — matching the current finalizer guarantee.

Keep `runScheduledTrail` (lines 120–131) as-is.

Ordering decision to confirm while implementing: where `BenchMetricEvent` should sit relative to the task stop. Currently bench metrics are emitted per completed trail inside the aggregation; the natural order after the fix is per-task: `TrailStaged → TaskMetric → Trail stop → (last trail) Task stop`, with `BenchMetricEvent` staying per-trail and `EvalScheduleEvent stop` last.

## Verification

Re-run a single task with the console transport and assert the ordering:

```bash
cd packages/eval
VERILOG_EVAL_EVENTS=1 VERILOG_EVAL_SINGLE=1 node tests/verilog-eval.test.ts
```

The test keeps `Event.Transport.Console.layer()` behind `VERILOG_EVAL_EVENTS=1` (and `Bench.head(1)` behind `VERILOG_EVAL_SINGLE=1`), so no code edits are needed to observe a run.

Expected skeleton: `TrailScheduleEvent stop` before `TaskScheduleEvent stop` before `EvalScheduleEvent stop`, with `TaskScheduleEvent stop` right after the task's last trail events. Also re-run the full 10% sample to confirm no event loss (scope finalizer removal must not drop stop events on success) and that `Eval.run` still returns normally.

## Related code

- `packages/eval/src/eval/schedule.ts` — the three schedule-event sites (lines 79–87, 120–131, 173–181) and the aggregation loop (line 199).
- `packages/eval/src/eval/run.ts:35` — `Effect.ensuring(Queue.end(eventQueue))`; finalizers currently emit stop events *before* the queue ends, so no events are lost today — only late.
- Event schema: `packages/eval/src/event/schema.ts` (`EvalScheduleEvent` / `TaskScheduleEvent` / `TrailScheduleEvent` with `op: "start" | "stop" | "pause"`).
- Observation transport: `packages/eval/src/event/transport/builtin/console/` (`Transport.Console.layer()`).
- Consumers that will benefit: `packages/eval/src/event/transport/builtin/sse/`, `packages/eval/src/event/persist/builtin/parquet/`.
