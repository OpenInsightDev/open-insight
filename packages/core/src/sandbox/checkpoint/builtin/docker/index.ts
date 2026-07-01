import * as Checkpoint from "../../index.ts";
import * as Snapshot from "../../../snapshot/index.ts";
import { SandboxError } from "../../../error.ts";
import { Crypto, Effect } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { Spawn } from "@open-insight/utils";
import { makeRuntime } from "../../../provider/builtin/docker/utils.ts";

export type MakeOptions = Readonly<{}>;

export const make = Effect.fn(
  function* ({}: MakeOptions): Effect.fn.Return<
    Checkpoint.Checkpoint,
    SandboxError,
    Crypto.Crypto | Spawn.SpawnService
  > {
    const runtime = yield* makeRuntime().pipe(Effect.mapError(SandboxError.provider("docker")));
    const crypto = yield* Crypto.Crypto;
    const spawner = yield* Spawn.SpawnService;

    const commit = Effect.fn(function* ({
      sandbox,
    }: Parameters<Checkpoint.Checkpoint["commit"]>[0]): Effect.fn.Return<
      Snapshot.Snapshot,
      SandboxError
    > {
      const mapProviderError = Effect.mapError(SandboxError.provider("docker"));

      // Determine the running container by reading the hostname from inside
      // the sandbox (Docker defaults hostname to the container ID).
      const hostname = yield* sandbox.$(CP.make`hostname`);
      const containerID = hostname.trim();
      if (containerID === "") {
        return yield* Effect.fail(
          SandboxError.provider("docker")(
            new Error("Could not determine container ID from sandbox hostname"),
          ),
        );
      }

      // Commit the container's current state as a new Docker image.
      // The runtime prefix adds the docker binary, so use "commit" directly.
      const imageID = yield* spawner
        .string(CP.make`commit ${containerID}`.pipe(runtime))
        .pipe(mapProviderError);

      const id = imageID.trim();

      // Build a Snapshot from the committed image ID.
      const checkpointSnapshot = Snapshot.fromImage(id);

      // Tag the image with the snapshot's content-addressable name so that
      // Provider.runSandbox can resolve it via Snapshot.makeName.
      const imageName = yield* Snapshot.makeName(checkpointSnapshot).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.mapError(SandboxError.snapshotBuild(checkpointSnapshot)),
      );

      yield* spawner.string(CP.make`tag ${id} ${imageName}`.pipe(runtime)).pipe(mapProviderError);

      return checkpointSnapshot;
    }) satisfies Checkpoint.Checkpoint["commit"];

    return {
      commit,
    } satisfies Checkpoint.Checkpoint;
  },
  (effect) => effect.pipe(Effect.provide(Spawn.SpawnService.layer)),
);
