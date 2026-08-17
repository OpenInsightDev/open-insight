import { SandboxError } from "#/sandbox/export.ts";
import * as Snapshot from "#/snapshot/export.ts";
import { Effect } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import * as Spawn from "#/spawn/export.ts";

const imageExists = Effect.fn(function* (snapshot: Snapshot.Snapshot) {
  const spawner = yield* Spawn.Service;
  return yield* spawner.success(CP.make`container image inspect ${snapshot.name}`).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );
});

const removeImage = Effect.fn(function* (snapshot: Snapshot.Snapshot) {
  const spawner = yield* Spawn.Service;
  yield* Effect.logDebug("Removing uncached Apple container image", { image: snapshot.name });
  yield* spawner.success(CP.make`container image delete --force ${snapshot.name}`).pipe(
    Effect.tap(() =>
      Effect.logDebug("Removed uncached Apple container image", {
        image: snapshot.name,
      }),
    ),
    Effect.catch((error) =>
      Effect.logWarning("Failed to remove uncached Apple container image", {
        image: snapshot.name,
        error,
      }),
    ),
  );
});

export const acquireSnapshot = Effect.fn(
  function* ({ template, cache = false }) {
    const spawner = yield* Spawn.Service;
    const snapshot = yield* Snapshot.make(template);
    yield* Effect.annotateCurrentSpan({
      appleContainerImage: snapshot.name,
      snapshotContext: template.context,
    });

    if (yield* imageExists(snapshot)) {
      yield* Effect.logDebug("Using cached Apple container snapshot image", {
        image: snapshot.name,
        context: template.context,
      });
      return snapshot;
    }

    yield* Effect.logInfo("Building Apple container snapshot image", {
      image: snapshot.name,
      context: template.context,
      cache,
    });

    const containerfilePath = Snapshot.isContainerfile(template)
      ? template.filePath
      : yield* Snapshot.writeInstructions(template);
    yield* spawner.success(
      CP.make`container build --file ${containerfilePath} --tag ${snapshot.name} ${template.context}`,
    );
    yield* Effect.logInfo("Built Apple container snapshot image", {
      image: snapshot.name,
      context: template.context,
    });

    if (!cache) {
      yield* Effect.addFinalizer(() => removeImage(snapshot));
    }

    return snapshot;
  },
  (effect, { template }) =>
    effect.pipe(
      Effect.annotateLogs({ snapshotContext: template.context }),
      Effect.mapError(SandboxError.snapshot(Snapshot.SnapshotError.build(template))),
    ),
);

export const deriveSnapshot = Effect.fn(
  function* ({ snapshot, context, instructions, cache = false }) {
    const spawner = yield* Spawn.Service;
    const derived = yield* Snapshot.derive({ snapshot, instructions });
    yield* Effect.annotateCurrentSpan({
      baseAppleContainerImage: snapshot.name,
      appleContainerImage: derived.name,
      snapshotContext: context,
    });

    if (yield* imageExists(derived)) {
      yield* Effect.logDebug("Using cached derived Apple container image", {
        baseImage: snapshot.name,
        image: derived.name,
        context,
      });
      return derived;
    }

    yield* Effect.logInfo("Building derived Apple container image", {
      baseImage: snapshot.name,
      image: derived.name,
      context,
      cache,
    });

    const containerfilePath = yield* Snapshot.writeInstructions(
      Snapshot.makeTemplateWith({ image: snapshot.name, instructions, context }),
    );
    yield* spawner.success(
      CP.make`container build --file ${containerfilePath} --tag ${derived.name} ${context}`,
    );
    yield* Effect.logInfo("Built derived Apple container image", {
      baseImage: snapshot.name,
      image: derived.name,
      context,
    });

    if (!cache) {
      yield* Effect.addFinalizer(() => removeImage(derived));
    }

    return derived;
  },
  (effect, { snapshot, instructions }) =>
    effect.pipe(
      Effect.annotateLogs({ baseAppleContainerImage: snapshot.name }),
      Effect.mapError(
        SandboxError.snapshot(Snapshot.SnapshotError.derive(snapshot.name, instructions)),
      ),
    ),
);
