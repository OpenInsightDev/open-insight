import { assert, describe, it } from "@effect/vitest";
import { Snapshot } from "@open-insight/core";
import { Effect } from "effect";
import { Prompt } from "effect/unstable/ai";
import * as Task from "../task/index.ts";
import { make } from "./build.ts";
import { randomSelect, select, skip, head } from "./select.ts";

const makeTask = (name: string) =>
  Effect.succeed(
    new Task.Task<Record<string, never>, never>({
      name,
      prompt: [Prompt.userMessage({ content: [Prompt.textPart({ text: name })] })],
      grader: async (): Promise<Record<string, never>> => ({}),
      snapshot: Snapshot.make({ image: "scratch" }),
    }),
  );

const tasks = [makeTask("task-1"), makeTask("task-2"), makeTask("task-3")];

describe("bench selection", () => {
  it.effect("marks a newly created bench as a full dataset", () =>
    Effect.gen(function* () {
      const bench = yield* make({ name: "test", tasks });

      assert.isFalse(bench.subset);
    }),
  );

  it.effect("skips tasks and marks the bench as a subset", () =>
    Effect.gen(function* () {
      const bench = yield* make({ name: "test", tasks }).pipe(skip(1));

      assert.strictEqual(bench.tasks.length, 2);
      assert.isTrue(bench.subset);
    }),
  );

  it.effect("takes the first tasks and marks the bench as a subset", () =>
    Effect.gen(function* () {
      const bench = yield* make({ name: "test", tasks }).pipe(head(2));

      assert.strictEqual(bench.tasks.length, 2);
      assert.isTrue(bench.subset);
    }),
  );

  it.effect("selects tasks by id and marks the bench as a subset", () =>
    Effect.gen(function* () {
      const bench = yield* make({ name: "test", tasks }).pipe(select(["task-1", "task-3"]));
      const selectedTasks = yield* Effect.all(bench.tasks);

      assert.deepStrictEqual(
        selectedTasks.map((task) => task.name),
        ["task-1", "task-3"],
      );
      assert.isTrue(bench.subset);
    }),
  );

  it.effect("randomly selects tasks and marks the bench as a subset", () =>
    Effect.gen(function* () {
      const bench = yield* make({ name: "test", tasks }).pipe(randomSelect(2));

      assert.strictEqual(bench.tasks.length, 2);
      assert.isTrue(bench.subset);
    }),
  );
});
