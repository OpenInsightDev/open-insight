import { Schema } from "effect";

export const EvalID = Schema.Struct({
  benchID: Schema.String,
  harnessID: Schema.String,
});
export type EvalID = Schema.Schema.Type<typeof EvalID>;

export const TaskID = Schema.Struct({
  ...EvalID.fields,
  taskID: Schema.String,
});
export type TaskID = Schema.Schema.Type<typeof TaskID>;

export const TrailID = Schema.Struct({
  ...TaskID.fields,
  trailIdx: Schema.String,
});
export type TrailID = Schema.Schema.Type<typeof TrailID>;

export const SessionID = Schema.Struct({
  ...TrailID.fields,
  sessionIdx: Schema.String,
});
export type SessionID = Schema.Schema.Type<typeof SessionID>;

const TaskEndEvent = <S extends Schema.Constraint>(schema: S) =>
  Schema.Struct({
    id: TaskID,
    result: schema,
  });
export type TaskEndEvent<S extends Schema.Constraint = any> = Readonly<{
  id: TaskID;
  result: S;
}>;

export const TrailEndEvent = <G extends Schema.Constraint>(schema: G) =>
  Schema.Struct({
    id: TrailID,
    grade: schema,
  });
export type TrailEndEvent<G extends Schema.Constraint = any> = Readonly<{
  id: TrailID;
  grade: G;
}>;
