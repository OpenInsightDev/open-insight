import type { Schema } from "effect";
import { produce } from "immer";
import * as Result from "./result.ts";
import type { Task } from "./build.ts";

export * from "./build.ts";
export * as Result from "./result.ts";

export type ResultOf<T> = T extends Task<any, any, infer R> ? R : never;
export const result =
  <G extends Schema.Constraint, R extends Schema.Constraint>(schema: R, exec: Result.Exec<G, R>) =>
  <Name extends string>(task: Task<Name, G, any>): Task<Name, G, R> =>
    produce(task, (task) => {
      task.result = Result.make(schema, exec);
    });
