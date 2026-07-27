import * as Sandbox from "#/sandbox/export.ts";
import * as Snapshot from "#/snapshot/export.ts";
import { Spawn } from "#/utils/export.ts";
import { Effect, FileSystem } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";

export const startBuilder = Effect.fn(function* () {
  const spawner = yield* Spawn.Service;
  yield* spawner.success(CP.make`container builder start`);
});

const imageExists = Effect.fn(function* (handle: Snapshot.Handle.Handle) {
  const spawner = yield* Spawn.Service;
  return yield* spawner.success(CP.make`container image inspect ${handle.name}`).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );
});

const removeImage = (handle: Snapshot.Handle.Handle) =>
  Effect.gen(function* () {
    const spawner = yield* Spawn.Service;
    yield* Effect.logDebug("Removing uncached Apple container image", { image: handle.name });
    yield* spawner.success(CP.make`container image delete --force ${handle.name}`);
    yield* Effect.logDebug("Removed uncached Apple container image", { image: handle.name });
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Failed to remove uncached Apple container image", {
        image: handle.name,
        error,
      }),
    ),
  );

const buildImage = Effect.fn(function* ({
  containerfilePath,
  context,
  image,
}: Readonly<{
  containerfilePath: string;
  context: string;
  image: string;
}>) {
  const spawner = yield* Spawn.Service;
  yield* spawner.success(
    CP.make`container build --file ${containerfilePath} --tag ${image} ${context}`,
  );
});

const writeInstructions = Effect.fn(function* (snapshot: Snapshot.InstructionsSnapshot) {
  const fs = yield* FileSystem.FileSystem;
  const containerfilePath = yield* fs.makeTempFile({
    prefix: "open-insight-",
    suffix: ".Containerfile",
  });
  yield* fs.writeFileString(containerfilePath, Snapshot.encode(snapshot));
  return containerfilePath;
});

export const aquireSnapshot = Effect.fn(
  function* ({ snapshot, cache }) {
    const handle = yield* Snapshot.Handle.make(snapshot);
    yield* Effect.annotateCurrentSpan({
      appleContainerImage: handle.name,
      snapshotContext: snapshot.context,
    });

    if (yield* imageExists(handle)) {
      yield* Effect.logDebug("Using cached Apple container snapshot image", {
        image: handle.name,
        context: snapshot.context,
      });
      return handle;
    }

    yield* Effect.logInfo("Building Apple container snapshot image", {
      image: handle.name,
      context: snapshot.context,
      cache: cache ?? false,
    });

    const containerfilePath = Snapshot.isContainerfile(snapshot)
      ? snapshot.filePath
      : yield* writeInstructions(snapshot);
    yield* buildImage({
      containerfilePath,
      context: snapshot.context,
      image: handle.name,
    });
    yield* Effect.logInfo("Built Apple container snapshot image", {
      image: handle.name,
      context: snapshot.context,
    });

    if (!cache) {
      yield* Effect.addFinalizer(() => removeImage(handle));
    }

    return handle;
  },
  (effect, { snapshot }) =>
    effect.pipe(
      Effect.annotateLogs({ snapshotContext: snapshot.context }),
      Effect.mapError(Sandbox.Error.snapshot(Snapshot.Error.build(snapshot))),
    ),
);

export const deriveSnapshot = Effect.fn(
  function* ({ handle, context, instructions, cache }) {
    const derived = yield* Snapshot.Handle.derive({ handle, instructions });
    yield* Effect.annotateCurrentSpan({
      baseAppleContainerImage: handle.name,
      appleContainerImage: derived.name,
      snapshotContext: context,
    });

    if (yield* imageExists(derived)) {
      yield* Effect.logDebug("Using cached derived Apple container image", {
        baseImage: handle.name,
        image: derived.name,
        context,
      });
      return derived;
    }

    yield* Effect.logInfo("Building derived Apple container image", {
      baseImage: handle.name,
      image: derived.name,
      context,
      cache: cache ?? false,
    });

    const containerfilePath = yield* writeInstructions(
      Snapshot.make({ image: handle.name, instructions, context }),
    );
    yield* buildImage({
      containerfilePath,
      context,
      image: derived.name,
    });
    yield* Effect.logInfo("Built derived Apple container image", {
      baseImage: handle.name,
      image: derived.name,
      context,
    });

    if (!cache) {
      yield* Effect.addFinalizer(() => removeImage(derived));
    }

    return derived;
  },
  (effect, { handle, instructions }) =>
    effect.pipe(
      Effect.annotateLogs({ baseAppleContainerImage: handle.name }),
      Effect.mapError(Sandbox.Error.snapshot(Snapshot.Error.derive(handle.name, instructions))),
    ),
);
