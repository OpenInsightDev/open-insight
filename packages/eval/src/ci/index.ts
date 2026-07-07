import * as Task from "@/task/index.ts";

export type Config = Readonly<{
  tasks: Task.Tasks;
}>;
