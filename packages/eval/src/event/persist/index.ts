import type { Stream } from "effect";
import type {
  TaskErrorEvent,
  TaskSuccessEvent,
  TrailErrorEvent,
  TrailSuccessEvent,
} from "../schema.ts";
import * as Task from "#/task/index.ts";

export type Persist<T extends Task.Any> = Readonly<{
  task: T;

  loadTrail(
    idx: number,
  ): Stream.Stream<TrailSuccessEvent, TrailErrorEvent | Task.Result.TrailResult<Task.GradeOf<T>>>;

  loadTask(): Stream.Stream<TaskSuccessEvent, TaskErrorEvent | Task.Result.ResultOf<T>>;
}>;
