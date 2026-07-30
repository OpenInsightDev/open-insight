import { Bench, Grade, Snapshot, Task } from "@open-insight/eval";
import { NodeServices } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";

const datasetId = "cvdp-benchmark";
const simImage = "nvidia/cvdp-sim:v1.0.0";
const datasetUrl =
  "https://raw.githubusercontent.com/NVlabs/cvdp_benchmark/8e894cf74414ab1eaea1e2b4e80a02f123df07b6/example_dataset/cvdp_v1.1.0_example_agentic_code_generation_no_commercial_with_solutions.jsonl";

class CvdpDatapoint extends Schema.Class<CvdpDatapoint>("CvdpDatapoint")({
  id: Schema.String,
  categories: Schema.Array(Schema.String),
  system_message: Schema.String,
  prompt: Schema.String,
  context: Schema.Record(Schema.String, Schema.String),
  patch: Schema.Record(Schema.String, Schema.String),
  harness: Schema.Record(Schema.String, Schema.String),
}) {}

const template = Task.Template.make({
  Extras: {
    categories: Schema.Array(Schema.String),
  },
  Grade: {
    passed: Schema.Boolean,
  },
});

const writeFiles = Effect.fn(function* (root: string, files: Readonly<Record<string, string>>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolvedRoot = path.resolve(root);

  yield* Effect.forEach(Object.entries(files), ([relativePath, content]) => {
    const target = path.resolve(resolvedRoot, relativePath);
    if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
      return Effect.fail(new Error(`CVDP file escapes its task directory: ${relativePath}`));
    }
    return fs
      .makeDirectory(path.dirname(target), { recursive: true })
      .pipe(Effect.andThen(fs.writeFileString(target, content)));
  });
});

const makeTask = Effect.fn(function* (datapoint: CvdpDatapoint) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const taskDir = yield* fs.makeTempDirectoryScoped({ prefix: "open-insight-cvdp-" });
  const codeDir = path.join(taskDir, "code");
  const harnessDir = path.join(taskDir, "harness");

  yield* writeFiles(codeDir, datapoint.context);
  yield* writeFiles(harnessDir, datapoint.harness);

  const environment = Object.fromEntries(
    (datapoint.harness["src/.env"] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .flatMap((line) => {
        const separator = line.indexOf("=");
        return separator < 0
          ? []
          : [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]];
      }),
  );

  const snapshot = Snapshot.make({
    image: simImage,
    context: taskDir,
    instructions: [
      Snapshot.copy(["code/"], "/code/"),
      Snapshot.copy(["harness/src/"], "/src/"),
      Snapshot.env(environment),
      Snapshot.workdir("/code"),
    ],
  });

  return yield* Task.make(template)({
    id: datapoint.id,
    name: datapoint.id,
    snapshot,
    extras: { categories: datapoint.categories },
  }).pipe(
    Task.endStage("solve", {
      prompt: [
        { role: "system", content: datapoint.system_message },
        { role: "user", content: datapoint.prompt },
      ],
      grader: Grade.make(
        async ({ $ }) => {
          try {
            await $`pytest -s --log-cli-level=INFO -o cache_dir=/tmp/cvdp-pytest-cache /src/test_runner.py -v`;
            return { passed: true };
          } catch {
            return { passed: false };
          }
        },
        {
          verif: async ({ $, writeFile }) => {
            for (const [index, patch] of Object.values(datapoint.patch).entries()) {
              const patchPath = `/tmp/cvdp-golden-${index}.patch`;
              await writeFile({ sandboxPath: patchPath, content: patch });
              await $`patch --directory=/code --strip=1 --forward --batch --input=${patchPath}`;
            }
            return null;
          },
          expect: { passed: true },
        },
      ),
    }),
  );
});

export const makeBench = Effect.fn(function* () {
  const source = yield* HttpClient.get(datasetUrl).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.text),
  );
  const datapoints = yield* Effect.all(
    source
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => Schema.decodeUnknownEffect(Schema.fromJsonString(CvdpDatapoint))(line)),
  );
  const tasks = yield* Effect.all(datapoints.map((datapoint) => makeTask(datapoint)));
  return yield* Bench.make({ id: datasetId, tasks });
});

const testLayer = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer);

layer(testLayer, { excludeTestServices: true })((it) => {
  it.effect(
    "loads the small CVDP example distribution",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const bench = yield* makeBench();

        assert.strictEqual(bench.metadata.id, datasetId);
        assert.lengthOf(bench.tasks, 1);

        const task = bench.tasks[0];
        assert.isDefined(task);
        assert.strictEqual(task.metadata.id, "cvdp_agentic_fixed_arbiter_0001");
        assert.deepStrictEqual(task.extras.categories, ["cid003", "easy"]);
        assert.lengthOf(task.stages, 1);
        assert.strictEqual(task.stages[0]?.metadata.name, "solve");
        assert.include(JSON.stringify(task.stages[0]?.prompt), "fixed_priority_arbiter");
        assert.isTrue(Snapshot.isInstructions(task.snapshot));
        if (Snapshot.isInstructions(task.snapshot)) {
          assert.strictEqual(task.snapshot.image, simImage);
        }
        assert.isTrue(
          yield* fs.exists(path.join(task.snapshot.context, "code", "docs", "specification.md")),
        );
        assert.isTrue(
          yield* fs.exists(path.join(task.snapshot.context, "harness", "src", "test_runner.py")),
        );
      }),
    30_000,
  );
});
