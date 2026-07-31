# Define a Snapshot

A `Snapshot` describes the initial sandbox environment required by a task.
It corresponds roughly to an image in a container runtime: a sandbox provider acquires the snapshot and starts isolated sandboxes from it.
A snapshot does not represent a running sandbox and does not define CPU, memory, GPU, network, or timeout limits.

The Snapshot API deliberately covers less than the full OCI Image Spec or a complete virtual machine configuration.
It keeps only a base environment, a build context, and a small set of build operations so that providers backed by Docker, Apple container, virtual machines, or other sandbox runtimes can implement the same contract.

There are two ways to define a snapshot.

1. Reuse the OCI ecosystem by referencing an existing OCI image or a local Containerfile.
2. Define the environment in code with a base OCI image and provider-independent instructions.

Prefer an Instructions snapshot whenever possible because it provides the widest compatibility across sandbox providers.
When the user provides a Dockerfile whose behavior can be expressed completely with Instructions, explain the compatibility benefit and recommend converting it.
Do not force the conversion when the Dockerfile uses advanced features, including but not limited to multi-stage builds, dynamic `ARG` values, BuildKit mounts, or other behavior that Instructions cannot preserve accurately.
In those cases, follow the user's direction and use the Dockerfile or Containerfile as provided.

## Reuse the OCI Ecosystem

### Reference an Existing Image

Pass an OCI image reference directly to `Snapshot.make` when the complete environment is already published.

```ts
import { Snapshot } from "@open-insight/eval";

const snapshot = Snapshot.make("ghcr.io/acme/task-env:2026-07-29");
```

The sandbox provider must be able to find the image locally or pull it from its registry.
Prefer an immutable tag or digest for reproducible benchmarks because a mutable tag can point to different content over time.
An image-only snapshot does not copy local files, so its default build context of `/tmp` usually needs no override.

### Use a Local Containerfile

Use `Snapshot.build` for an existing Dockerfile or Containerfile, or when the build requires features such as multi-stage builds or BuildKit mounts.

```ts
import { Snapshot } from "@open-insight/eval";
import { join, resolve } from "@std/path";
import { Effect } from "effect";

const makeSnapshot = Effect.fn(function* () {
  const context = resolve(import.meta.dirname!, "environment");

  return yield* Snapshot.build({
    filePath: join(context, "Containerfile"),
    context,
  });
});
```

`Snapshot.build` returns an `Effect` because it resolves the file and context to real absolute paths.
The context defaults to the Containerfile directory when omitted, and sources in `COPY` or `ADD` are relative to that context.
Open Insight passes the Containerfile to the sandbox provider without parsing or reducing it.
A provider that cannot build local Containerfiles fails with `SnapshotBuildUnsupported`.

## Define Instructions in Code

`Snapshot.make` accepts a base OCI image, an absolute host build context, and an ordered list of instructions.

- `Snapshot.run(command)` runs a shell command during the build.
- `Snapshot.env(values)` sets environment variables.
- `Snapshot.copy(sources, destination)` copies files or directories from the build context.
- `Snapshot.workdir(path)` sets the working directory for later build steps and the sandbox.
- `Snapshot.user(user)` sets the user for later build steps and the sandbox, using either `user` or `user:group`.
- `Snapshot.available(...programs)` and `Snapshot.assert(...commands)` create `Run` instructions that fail the build when their checks fail.

Instruction order matters, so create a user before switching to it and install tools before checking them.
Every `copy` source must be inside `context`.
The context is only a build input and is not mounted into the sandbox, so copy every file the task needs explicitly.

The following general example follows the patterns used in `packages/eval/tests/` and attaches the snapshot directly to a task.

```ts
import { Grade, Snapshot, Task } from "@open-insight/eval";
import { resolve } from "@std/path";
import { Effect, Schema } from "effect";

export const makeTask = Effect.fn(function* () {
  const context = resolve(import.meta.dirname!, "environment");
  const snapshot = Snapshot.make({
    image: "python:3.13-slim",
    context,
    instructions: [
      Snapshot.run("pip install --no-cache-dir pytest"),
      Snapshot.run("useradd --create-home --uid 1000 agent"),
      Snapshot.copy(["starter/", "tests/"], "/workspace/"),
      Snapshot.run("chown -R agent:agent /workspace"),
      Snapshot.env({ PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" }),
      Snapshot.workdir("/workspace"),
      Snapshot.available("python", "pytest"),
      Snapshot.user("agent"),
    ],
  });

  return yield* Task.make({
    id: "python-fix",
    name: "Fix the Python implementation",
    snapshot,
  }).pipe(
    Task.stage("solve", {
      prompt: "Fix the Python implementation.",
      grader: Grade.make(Schema.Struct({ passed: Schema.Boolean }))(
        async () => ({ passed: true }),
      ),
    }),
  );
});
```

This example expects `environment/starter/` and `environment/tests/` next to the module.
Keep the instruction set small, and switch to a local Containerfile instead of simulating a full build system with complex shell commands.
