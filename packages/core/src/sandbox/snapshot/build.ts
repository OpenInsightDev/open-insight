import { Crypto, Effect, Encoding } from "effect";
import { FileSystem, Path } from "effect";
import { decode, encode } from "./decode.ts";
import { Instructions } from "./inst.ts";
import { Image, Snapshot } from "./schema.ts";
import type { Context } from "../index.ts";
export { Image, Snapshot } from "./schema.ts";

/**
 * The name of the snapshot.
 *
 * Each snapshot must use this name and mapped to different hash tags.
 */
export const SNAPSHOT_NAME = "open-insight-snapshot";

export const make: typeof Snapshot.make = (args) => Snapshot.make(args);

export const hash = Effect.fn(function* (snapshot: Snapshot) {
  const crypto = yield* Crypto.Crypto;
  const containerfile = yield* encode(snapshot);
  const bytes = new TextEncoder().encode(containerfile);
  const digest = yield* crypto.digest("SHA-256", bytes);
  return Encoding.encodeHex(digest);
});

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

export const fromContainerfile = Effect.fn(function* ({
  context,
  filePath,
}: {
  context: Context.Context;
  filePath: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const containerfilePath = path.join(context, filePath);

  const content = yield* fs.readFileString(containerfilePath);
  return yield* decode(content);
});

/**
 * Create a snapshot from an OCI image reference.
 */
export const fromImage = (image: Image): Snapshot => Snapshot.make({ image, instructions: [] });

export const Scratch = fromImage("scratch");
