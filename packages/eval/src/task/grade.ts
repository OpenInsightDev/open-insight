import { Function, type Schema } from "effect";
import { castDraft, produce } from "immer";
import * as Task from "./task.ts";
import * as Grade from "#/grade/index.ts";
import type { Override } from "@open-insight/core/internal/utils";

/**
 * Replaces a task's grader with a new one.
 */
export const grade: {
  <G extends Schema.Constraint>(
    grader: Grade.Grader<G>,
  ): <T extends Task.Any>(task: T) => Override<T, Task.Task<Task.IdOf<T>, G>>;
  <T extends Task.Any, G extends Schema.Constraint>(
    task: T,
    grader: Grade.Grader<G>,
  ): Override<T, Task.Task<Task.IdOf<T>, G>>;
} = Function.dual(
  2,
  <T extends Task.Any, G extends Schema.Constraint>(
    task: T,
    grader: Grade.Grader<G>,
  ): Override<T, Task.Task<Task.IdOf<T>, G>> =>
    produce(task, (draft) => {
      draft.grader = castDraft(grader);
    }),
);

/**
 * Derives a task's grader from its current one.
 */
export const mapGrade: {
  <T extends Task.Any, G extends Schema.Constraint>(
    fn: (grader: Grade.Grader<Task.GradeOf<T>>) => Grade.Grader<G>,
  ): (task: T) => Override<T, Task.Task<Task.IdOf<T>, G>>;
  <T extends Task.Any, G extends Schema.Constraint>(
    task: T,
    fn: (grader: Grade.Grader<Task.GradeOf<T>>) => Grade.Grader<G>,
  ): Override<T, Task.Task<Task.IdOf<T>, G>>;
} = Function.dual(
  2,
  <T extends Task.Any, G extends Schema.Constraint>(
    task: T,
    fn: (grader: Grade.Grader<Task.GradeOf<T>>) => Grade.Grader<G>,
  ): Override<T, Task.Task<Task.IdOf<T>, G>> =>
    produce(task, (draft) => {
      draft.grader = castDraft(fn(draft.grader));
    }),
);
