import { Crypto, Effect, Encoding } from "effect";
import { encode } from "./decode.ts";
import { type Instructions } from "./instruction.ts";
import { type Image, Snapshot, SNAPSHOT_NAME } from "./schema.ts";

export const hash = Effect.fn(function* (snapshot: Snapshot) {
  const crypto = yield* Crypto.Crypto;
  const containerfile = yield* encode(snapshot);
  const bytes = new TextEncoder().encode(containerfile);
  const digest = yield* crypto.digest("SHA-256", bytes);
  return Encoding.encodeHex(digest);
});

/**
 * Get the name of a snapshot. The built snapshot must be tagged with this name.
 *
 * - The name of a snapshot is always `open-insight-snapshot`.
 * - The tag of a snapshot is the SHA-256 hash of the snapshot's content.
 */
export const makeName = Effect.fn(function* (snapshot: Snapshot) {
  const hashed = yield* hash(snapshot);
  return `${SNAPSHOT_NAME}:${hashed}`;
});

/**
 * Create a snapshot from an OCI image reference.
 */
export const fromImage = (image: Image): Snapshot => Snapshot.make({ image, instructions: [] });

/**
 * Extend an existing snapshot with a set of new instructions, without changing the base image.
 */
export const extend = ({
  snapshot,
  instructions,
}: {
  snapshot: Snapshot;
  instructions: Instructions;
}): Snapshot =>
  Snapshot.make({
    image: snapshot.image,
    instructions: [...snapshot.instructions, ...instructions],
  });

/**
 * Derive a new snapshot from an existing snapshot with a set of new instructions.
 *
 * Note that the base image of the given snapshot must exist.
 */
export const derive = Effect.fn(function* ({
  snapshot,
  instructions,
}: {
  snapshot: Snapshot;
  instructions: Instructions;
}) {
  const image = yield* makeName(snapshot);
  return Snapshot.make({ image, instructions });
});
