import { NodeServices } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, FileSystem, Option, Path } from "effect";
import * as Grade from "#/grade/index.ts";
import { Error } from "../error.ts";
import { fromDir } from "./local.ts";
import { makeTask } from "./index.ts";
import { mean } from "./reward.ts";
import { Resource, Snapshot } from "@open-insight/core/internal";

const writeFixture = Effect.fn(function* ({
  root,
  name,
  extraConfig = "",
}: {
  readonly root: string;
  readonly name: string;
  readonly extraConfig?: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.join(root, "environment"), { recursive: true });
  yield* fs.makeDirectory(path.join(root, "tests"), { recursive: true });
  yield* fs.writeFileString(
    path.join(root, "task.toml"),
    `[task]\nname = "${name}"\n\n[environment]\ndocker_image = "ubuntu:24.04"\n${extraConfig}`,
  );
  yield* fs.writeFileString(path.join(root, "instruction.md"), "Do the task.\n");
  yield* fs.writeFileString(
    path.join(root, "tests", "test.sh"),
    "#!/bin/bash\necho 1 > /logs/verifier/reward.txt\n",
  );
});

describe("Harbor task loading", () => {
  layer(NodeServices.layer)((it) => {
    it.effect("maps task metadata, resources, and image instructions", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped();
        yield* fs.makeDirectory(path.join(root, "environment"), { recursive: true });
        yield* fs.makeDirectory(path.join(root, "tests"), { recursive: true });
        yield* fs.makeDirectory(path.join(root, "solution"), { recursive: true });
        yield* fs.writeFileString(
          path.join(root, "task.toml"),
          `schema_version = "1.4"

[task]
name = "acme/example"
version = "1.2.3"
description = "Example task"
authors = [{ name = "Ada", email = "ada@example.com" }]
keywords = ["shell", "pytest"]

[metadata]
difficulty = "easy"

[agent]
timeout_sec = 45
user = "agent"
network_mode = "no-network"

[verifier]
timeout_sec = 30
user = "agent"
network_mode = "no-network"

[environment]
docker_image = "ubuntu:24.04"
cpus = 2
memory_mb = 4096
storage_mb = 8192
network_mode = "no-network"
workdir = "/app"
env = { MODE = "test" }
`,
        );
        yield* fs.writeFileString(path.join(root, "instruction.md"), "Create output.txt.\n");
        yield* fs.writeFileString(
          path.join(root, "tests", "test.sh"),
          "#!/bin/bash\necho 1 > /logs/verifier/reward.txt\n",
        );
        yield* fs.writeFileString(
          path.join(root, "solution", "solve.sh"),
          "#!/bin/bash\ntouch output.txt\n",
        );

        const task = yield* makeTask(root);

        assert.strictEqual(task.metadata.id, "acme/example");
        assert.deepStrictEqual(task.metadata.description, Option.some("Example task"));
        assert.deepStrictEqual(task.metadata.authors, Option.some(["Ada <ada@example.com>"]));
        assert.deepStrictEqual(task.extras, { difficulty: "easy" });
        assert.strictEqual(task.resources.numCPUs, 2);
        assert.strictEqual(task.resources.memoryMiB, 4096);
        assert.strictEqual(task.resources.storageMiB, 8192);
        assert.deepStrictEqual(task.resources.network, Resource.Network.noNetwork());
        assert.isTrue(Snapshot.isInstructions(task.snapshot));
        if (!Snapshot.isInstructions(task.snapshot)) {
          return assert.fail("Expected an instruction snapshot");
        }
        assert.deepStrictEqual(task.snapshot.instructions, [
          Snapshot.Inst.env({ MODE: "test" }),
          Snapshot.Inst.workdir("/app"),
          Snapshot.Inst.user("agent"),
        ]);
        assert.lengthOf(task.stages, 1);
        assert.strictEqual(task.stages[0]?.metadata.name, "main");
        assert.strictEqual(task.stages[0]?.prompt, "Create output.txt.\n");
        assert.isTrue(task.stages[0] !== undefined && Grade.isVerifiable(task.stages[0].grader));
      }),
    );

    it.effect("maps multi-step tasks to resumed stages with Harbor file fallbacks", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped();
        yield* fs.makeDirectory(path.join(root, "environment"), { recursive: true });
        yield* fs.makeDirectory(path.join(root, "tests"), { recursive: true });
        yield* fs.makeDirectory(path.join(root, "solution"), { recursive: true });
        yield* fs.makeDirectory(path.join(root, "steps", "prepare", "workdir"), {
          recursive: true,
        });
        yield* fs.makeDirectory(path.join(root, "steps", "finish", "tests"), {
          recursive: true,
        });
        yield* fs.writeFileString(
          path.join(root, "task.toml"),
          `[task]
name = "acme/multi"

multi_step_reward_strategy = "mean"

[environment]
docker_image = "ubuntu:24.04"

[[steps]]
name = "prepare"

[[steps]]
name = "finish"
`,
        );
        yield* fs.writeFileString(
          path.join(root, "tests", "test.sh"),
          "#!/bin/bash\necho 1 > /logs/verifier/reward.txt\n",
        );
        yield* fs.writeFileString(path.join(root, "solution", "solve.sh"), "#!/bin/bash\ntrue\n");
        yield* fs.writeFileString(
          path.join(root, "steps", "prepare", "instruction.md"),
          "Prepare.\n",
        );
        yield* fs.writeFileString(
          path.join(root, "steps", "prepare", "workdir", "setup.sh"),
          "#!/bin/bash\ntrue\n",
        );
        yield* fs.writeFileString(
          path.join(root, "steps", "finish", "instruction.md"),
          "Finish.\n",
        );
        yield* fs.writeFileString(
          path.join(root, "steps", "finish", "tests", "helper.txt"),
          "layered helper\n",
        );

        const task = yield* makeTask(root);

        assert.deepStrictEqual(
          task.stages.map((stage) => stage.metadata.name),
          ["prepare", "finish"],
        );
        assert.isNotNull(task.stages[0]?.init);
        assert.isNull(task.stages[1]?.init);
        assert.isTrue(task.stages.every((stage) => stage.resume));
        assert.isTrue(task.stages.every((stage) => Grade.isVerifiable(stage.grader)));
      }),
    );

    it.effect("extends Dockerfiles without changing the task directory", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped();
        yield* fs.makeDirectory(path.join(root, "environment"), { recursive: true });
        yield* fs.makeDirectory(path.join(root, "tests"), { recursive: true });
        yield* fs.writeFileString(
          path.join(root, "task.toml"),
          `[task]
name = "acme/dockerfile"

[agent]
user = 1000

[environment]
workdir = "/workspace"
env = { MODE = "test" }
`,
        );
        yield* fs.writeFileString(
          path.join(root, "environment", "Dockerfile"),
          "FROM ubuntu:24.04\nRUN mkdir /workspace\n",
        );
        yield* fs.writeFileString(path.join(root, "instruction.md"), "Do the task.\n");
        yield* fs.writeFileString(
          path.join(root, "tests", "test.sh"),
          "#!/bin/bash\necho 1 > /logs/verifier/reward.txt\n",
        );

        const task = yield* makeTask(root);

        assert.isTrue(Snapshot.isContainerfile(task.snapshot));
        if (!Snapshot.isContainerfile(task.snapshot)) {
          return assert.fail("Expected a Containerfile snapshot");
        }
        const envDir = yield* fs.realPath(path.join(root, "environment"));
        const dockerfile = yield* fs.realPath(path.join(envDir, "Dockerfile"));
        assert.notStrictEqual(task.snapshot.filePath, dockerfile);
        assert.strictEqual(task.snapshot.context, envDir);
        assert.include(
          yield* fs.readFileString(task.snapshot.filePath),
          'ENV MODE="test"\nWORKDIR /workspace\nUSER 1000\n',
        );
      }),
    );

    it.effect("rejects Harbor features the current task model cannot execute faithfully", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped();
        yield* writeFixture({
          root,
          name: "acme/separate",
          extraConfig:
            '\n[verifier]\nenvironment_mode = "separate"\n\n[verifier.environment]\ndocker_image = "ubuntu:24.04"\n',
        });

        const error = yield* makeTask(root).pipe(Effect.flip);

        assert.instanceOf(error, Error);
        assert.strictEqual(error.reason._tag, "UnsupportedTaskError");
      }),
    );

    it.effect("recursively loads Harbor task directories", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped();
        yield* writeFixture({ root: path.join(root, "a"), name: "acme/a" });
        yield* writeFixture({ root: path.join(root, "nested", "b"), name: "acme/b" });

        const tasks = yield* fromDir(root);

        assert.deepStrictEqual(
          tasks.map((task) => task.metadata.id),
          ["acme/a", "acme/b"],
        );
      }),
    );
  });
});

describe("Harbor reward aggregation", () => {
  it("uses a per-key mean and treats missing keys as zero", () => {
    assert.deepStrictEqual(mean([{ reward: 1, quality: 0.5 }, { reward: 0 }]), {
      reward: 0.5,
      quality: 0.25,
    });
  });
});
