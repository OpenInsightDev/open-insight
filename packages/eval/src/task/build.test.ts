import { assert, it } from "@effect/vitest";
import { Prompt, Snapshot } from "@open-insight/core/internal";
import { Schema } from "effect";
import { make, Metadata, type Options, type Task } from "./build.ts";

type GradeResult = { score: number };

const snapshot = Snapshot.make({ image: "scratch" });
const prompt = Prompt.userMessage({ content: [Prompt.textPart({ text: "test" })] });
const grader = async (): Promise<GradeResult> => ({ score: 1 });

class CustomMetadata extends Metadata.extend<CustomMetadata>("CustomTaskMetadata")({
  difficulty: Schema.Number,
}) {}

it("makes a task from options", () => {
  const task: Task<GradeResult> = make({
    name: "task",
    prompt,
    grader,
    snapshot,
  });

  assert.instanceOf(task.metadata, Metadata);
  assert.strictEqual(task.metadata.name, "task");
  assert.lengthOf(task.stages, 1);
});

it("curries options from an extended metadata schema", () => {
  const options = {
    name: "custom-task",
    difficulty: 3,
    prompt,
    grader,
    snapshot,
  } satisfies Options<GradeResult, typeof CustomMetadata>;

  const task: Task<GradeResult, CustomMetadata> = make(CustomMetadata)(options);

  assert.instanceOf(task.metadata, CustomMetadata);
  assert.strictEqual(task.metadata.name, "custom-task");
  assert.strictEqual(task.metadata.difficulty, 3);
});
