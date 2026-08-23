import { Schema } from "effect";

export const EvalID = Schema.Struct({
  benchID: Schema.String,
  harnessID: Schema.String,
});

export const TaskID = Schema.Struct({
  ...EvalID.fields,
  taskID: Schema.String,
});

const taskEndEvent = <S extends Schema.Constraint>(schema: S) =>
  Schema.Struct({
    result: schema,
  });
