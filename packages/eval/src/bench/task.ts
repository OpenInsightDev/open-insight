import { Effect } from "effect";
import { Bench, type Any } from "./bench.ts";

export const mapTasks =
  <B extends Any, Mapped extends B["tasks"]>(mapper: (tasks: B["tasks"], bench: B) => Mapped) =>
  (bench: B) => {
    const { tasks: _, ...properties } = bench;
    const tasks = mapper(bench.tasks, bench);

    return Object.assign(
      new Bench({
        id: bench.id,
        metadata: bench.metadata,
        tasks,
      }),
      properties,
    );
  };

export const mapTask =
  <B extends Any, Name extends Extract<keyof B["tasks"], string>, Mapped extends B["tasks"][Name]>(
    name: Name,
    mapper: (task: B["tasks"][Name], bench: B) => Mapped,
  ) =>
  (bench: B) =>
    mapTasks<B, B["tasks"] & Readonly<Record<Name, Mapped>>>((tasks) => ({
      ...tasks,
      [name]: mapper(tasks[name], bench),
    }))(bench);

export const mapTaskEffect =
  <
    B extends Any,
    Name extends Extract<keyof B["tasks"], string>,
    Mapped extends B["tasks"][Name],
    E,
    R,
  >(
    name: Name,
    mapper: (task: B["tasks"][Name], bench: B) => Effect.Effect<Mapped, E, R>,
  ) =>
  (bench: B) => {
    const map = (tasks: B["tasks"]) => mapper(tasks[name], bench);

    return Effect.map(map(bench.tasks), (mapped) =>
      mapTask<B, Name, Mapped>(name, () => mapped)(bench),
    );
  };
