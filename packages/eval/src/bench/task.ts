import * as Task from "#/task/index.ts";
import { produce } from "immer";
import type { Override } from "../utils/type.ts";
import type { Any, Bench, IDOf, TasksOf } from "./bench.ts";

type MappedTasks<
  Tasks extends Record<string, Task.Any>,
  Name extends keyof Tasks,
  Mapped extends Task.Any,
> = {
  readonly [Key in keyof Tasks]: Key extends Name ? Mapped : Tasks[Key];
};

export const mapTask =
  <B extends Any, Name extends keyof TasksOf<B>, Mapped extends Task.Any>(
    name: Name,
    mapper: (task: TasksOf<B>[Name]) => Mapped,
  ) =>
  (bench: B): Override<B, Bench<IDOf<B>, MappedTasks<TasksOf<B>, Name, Mapped>>> =>
    bench.pipe(
      produce((draft) => {
        draft.tasks[name] = mapper(draft.tasks[name]);
      }),
    );
