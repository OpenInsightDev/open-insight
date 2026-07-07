import { Crypto, Effect, Encoding } from "effect";
import * as Context from "./context.ts";
import { FileSystem, Path } from "effect";
import { Instructions } from "./inst.ts";
import * as Image from "./image.ts";
import { Schema } from "effect";
import { decode } from "./decode.ts";

export const parsedContainerfileFields = {
  image: Image.Image,
  instructions: Instructions,
};
export const ParsedContainerfile = Schema.Struct(parsedContainerfileFields);
export type ParsedContainerfile = Schema.Schema.Type<typeof ParsedContainerfile>;

/**
 * A snapshot represents a specific state of a container image, including its base image, the instructions used to build it, and the context in which it was built.
 *
 * It's basically a subset of the Containerfile.
 * However, for sandbox providers that do not support building from a Containerfile, the Snapshot can be used to provide sufficient information for providers to build sandbox.
 */
export class Snapshot extends Schema.Class<Snapshot>("Snapshot")({
  ...parsedContainerfileFields,
  context: Context.Context,
}) {}

/**
 * The name of the snapshot.
 *
 * Each snapshot must use this name and mapped to different hash tags.
 */
export const SNAPSHOT_NAME = "open-insight-snapshot";

export const hash = Effect.fn(function* (snapshot: Snapshot) {
  const crypto = yield* Crypto.Crypto;
  const { encode } = yield* Effect.promise(() => import("./decode.ts"));
  const containerfile = yield* encode(snapshot);
  const bytes = new TextEncoder().encode(containerfile);
  const digest = yield* crypto.digest("SHA-256", bytes);
  return Encoding.encodeHex(digest);
});

/**
 * Extend an existing snapshot with a set of new instructions, without changing the base image.
 */
export const extend =
  (instructions: Instructions) =>
  (snapshot: Snapshot): Snapshot =>
    Snapshot.make({
      image: snapshot.image,
      instructions: [...snapshot.instructions, ...instructions],
      context: snapshot.context,
    });

export const fromContainerfile = Effect.fn(function* ({
  filePath,
  context,
}: {
  filePath: string;
  context?: Context.Context;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  filePath = path.resolve(filePath);
  context ??= Context.fromDir(path.dirname(filePath));

  const content = yield* fs.readFileString(filePath);
  const parsed = yield* decode(content);
  return Snapshot.make({ ...parsed, context });
});

/**
 * Create a snapshot from an OCI image reference.
 */
export const make = ({
  image,
  context = Context.DontCare,
  instructions = [],
}: {
  image: string;
  context?: string;
  instructions?: Instructions;
}) => Snapshot.make({ image: Image.make(image), context: Context.fromDir(context), instructions });

export const Scratch = make({ image: Image.make("scratch") });
