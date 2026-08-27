import type { Schema } from "effect";
import * as Task from "./task.ts";
import * as Grade from "#/grade/index.ts";

export const grade =
  <G extends Schema.Constraint>(grader: Grade.Grader<G>) =>
  <T extends Task.Any>(task: T) => {};

export const extendGrade =
  <G extends Schema.Constraint>() =>
  <T extends Task.Any>(task: T) => {};
