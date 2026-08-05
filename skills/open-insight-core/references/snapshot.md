# Snapshot

A `Snapshot` describes the initial sandbox environment required by a task.
It corresponds roughly to an image in a container runtime: a sandbox provider acquires the snapshot and starts isolated sandboxes from it.
A snapshot does not represent a running sandbox and does not define CPU, memory, GPU, network, or timeout limits

The Snapshot API deliberately covers less than the full OCI Image Spec or a complete virtual machine configuration.
It keeps only a base environment, a build context, and a small set of build operations so that providers backed by Docker, Apple container, virtual machines, or other sandbox runtimes can implement the same contract.

There are 3 ways to define a snapshot, in order of preference.

1. Define the environment in code with a base OCI image and provider-independent instructions — this provides the widest compatibility across sandbox providers.
2. Reuse an existing OCI image when the complete environment is already published.
3. Build a Containerfile only when the build requires features that Instructions cannot express, such as multi-stage builds or BuildKit mounts.

When the user provides a Dockerfile whose behavior can be expressed completely with Instructions, explain the compatibility benefit and recommend converting it.
Do not force the conversion when the Dockerfile uses advanced features, including but not limited to multi-stage builds, dynamic `ARG` values, BuildKit mounts, or other behavior that Instructions cannot preserve accurately.
In those cases, follow the user's direction and use the Dockerfile or Containerfile as provided.

## Reference an Existing Image

Pass an OCI image reference directly to `Snapshot.make` when the complete environment is already published.

```ts
import { Snapshot } from "@open-insight/eval";

const snapshot = Snapshot.make("ghcr.io/acme/task-env:2026-07-29");
```

The sandbox provider must be able to find the image locally or pull it from its registry.
Prefer an immutable tag or digest for reproducible benchmarks because a mutable tag can point to different content over time.

## Build a Containerfile

Use `Snapshot.build()` for an existing Dockerfile or Containerfile, or when the build requires features such as multi-stage builds or BuildKit mounts.
The image is not built immediately; the sandbox provider builds it on demand.

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

The context defaults to the Containerfile directory when omitted, and sources in `COPY` or `ADD` are relative to that context.
A snapshot used as a sandbox environment must not set its own `ENTRYPOINT` or `CMD`: before applying a snapshot, Open Insight always appends `CMD ["sleep","infinity"]` as the default command — to the Containerfile and to every instruction snapshot — so the sandbox stays alive instead of exiting immediately after it starts.
The rest of the Containerfile is passed to the sandbox provider without otherwise parsing or reducing it.

Not every sandbox provider can build images.
Providers such as a local Docker runtime can build the Containerfile, while remote or restricted providers may have no image-building capability at all.
On those providers, a Containerfile snapshot fails with an error when the sandbox starts, so it is less portable than an Instructions snapshot.

## Define Instructions in Code

`Snapshot.makeWith` accepts a base OCI image, an absolute host build context, and an ordered list of instructions.

- `Snapshot.run(command, options?)` runs a shell command during the build; its optional `network` mode can be `default`, `none`, or `host`.
- `Snapshot.env(values)` sets environment variables.
- `Snapshot.copy(sources, destination, options?)` copies files or directories and can pass Docker `COPY` options: `from`, `chmod`, `chown`, `link`, `parents`, and `exclude`.
- `Snapshot.workdir(path)` sets the working directory for later build steps and the sandbox.
- `Snapshot.user(user)` sets the user for later build steps and the sandbox, using either `user` or `user:group`.
- `Snapshot.available(...programs)` fails the build if any of the listed programs are not found in the `PATH`.
- `Snapshot.assert(...commands)` fails the build if any of the listed commands return a non-zero exit code.

Instruction order matters, so create a user before switching to it and install tools before checking them.
Unless `from` is set, every `copy` source must be inside `context`. When `from` is set, Docker may resolve the source from a build stage, named context, or image.
The context is only a build input and is not mounted into the sandbox, so copy every file the task needs explicitly.

The following general example follows the patterns used in `packages/eval/tests/` and attaches the snapshot directly to a task.

```ts
import { Snapshot } from "@open-insight/core";
import { resolve } from "@std/path";
import { Effect, Schema } from "effect";

const snapshot = Snapshot.makeWith({
    image: "python:3.13-slim",
    context: resolve(import.meta.dirname!, "environment"),
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
```
