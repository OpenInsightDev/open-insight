/**
 * SQLite persistence schemas for eval events.
 *
 * Design follows the hierarchy from AGENTS.md:
 *   - Trail is the basic unit — always complete when persisted.
 *   - Task has start/end + links to trails — replayable if end exists.
 *   - Bench has start/end + links to tasks — same replayability logic.
 *
 * Four tables:
 *   - Event: raw event log (all events stored as JSON)
 *   - BenchStatus: bench lifecycle tracking
 *   - TaskStatus: task lifecycle tracking
 *   - TrailStatus: trail lifecycle + result data
 */
import { Model } from "effect/unstable/schema";
import { Schema } from "effect";
import { BenchFields, TaskFields, TrailFields } from "#/event/schema.ts";

// ─── Event table ───────────────────────────────────────────────────────
// Stores every event as a JSON payload for full fidelity replay.

export class Event extends Model.Class<Event>("Event")({
  id: Model.GeneratedByDb(Schema.Number),
  ...BenchFields,
  taskId: Model.FieldOption(Schema.String),
  trailIdx: Model.FieldOption(Schema.Int),
  sessionIdx: Model.FieldOption(Schema.Int),
  eventType: Schema.String,
  payload: Model.JsonFromString(Schema.Unknown),
  createdAt: Model.DateTimeInsertFromDate,
}) {}

// ─── BenchStatus table ─────────────────────────────────────────────────
// Tracks bench lifecycle.  Presence of endedAt = fully completed.

export class BenchStatus extends Model.Class<BenchStatus>("BenchStatus")({
  id: Model.GeneratedByDb(Schema.Number),
  ...BenchFields,
  startedAt: Model.DateTimeInsertFromDate,
  endedAt: Model.FieldOption(Schema.DateTimeUtcFromDate),
}) {}

// ─── TaskStatus table ──────────────────────────────────────────────────
// Tracks task lifecycle.  Presence of endedAt = fully completed.
// Trail count is derived from TrailStatus, not stored here.

export class TaskStatus extends Model.Class<TaskStatus>("TaskStatus")({
  id: Model.GeneratedByDb(Schema.Number),
  ...TaskFields,
  startedAt: Model.DateTimeInsertFromDate,
  endedAt: Model.FieldOption(Schema.DateTimeUtcFromDate),
}) {}

// ─── TrailStatus table ─────────────────────────────────────────────────
// The fundamental replayable unit.  A persisted trail is always complete.
//
// Fields map to TrailEndEvent:
//   - grade: the evaluation result
//   - usage: token usage from the final session
//   - endedAt: set when trail completes successfully

export class TrailStatus extends Model.Class<TrailStatus>("TrailStatus")({
  id: Model.GeneratedByDb(Schema.Number),
  ...TrailFields,
  grade: Model.FieldOption(Schema.Unknown),
  usage: Model.FieldOption(Schema.Unknown),
  startedAt: Model.DateTimeInsertFromDate,
  endedAt: Model.FieldOption(Schema.DateTimeUtcFromDate),
}) {}
