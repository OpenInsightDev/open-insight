import { Crypto, Effect, Encoding } from "effect";
import { FileSystem, Path } from "effect";
import { Instructions } from "./inst.ts";
import { Schema } from "effect";
import { decode, decodeSync } from "./decode.ts";

const Image = Schema.String.pipe(Schema.brand("Image"));
type Image = Schema.Schema.Type<typeof Image>;

const OciImageReference =
  /^(?:(?<domain>[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)(?::(?<port>\d+))?\/)?(?<repository>[a-z0-9]+(?:(?:[._]|__|[-]*)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|[-]*)[a-z0-9]+)*)*)(?::(?<tag>[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}))?(?:@(?<digest>[a-zA-Z0-9-_]+:[a-fA-F0-9]{32,}))?$/;

const ImageFromString = Schema.String.check(
  Schema.isPattern(OciImageReference, { expected: "a valid OCI image reference" }),
).pipe(Schema.decodeTo(Image));

export const parsedContainerfileFields = {
  image: ImageFromString,
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

  /**
   * Build context for the snapshot.
   *
   * Must be a absolute directory path on the host machine.
   */
  context: Schema.String,
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
  context?: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  filePath = path.resolve(filePath);
  context ??= path.dirname(filePath);

  const content = yield* fs.readFileString(filePath);
  const parsed = yield* decode(content);
  return Snapshot.make({ ...parsed, context });
});

export const parseContainerfile = (
  content: string,
  { context = "/tmp" }: { context?: string } = {},
) => {
  const parsed = decodeSync(content);
  return Snapshot.make({ ...parsed, context });
};

/**
 * Create a snapshot from an OCI image reference.
 */
export const make = ({
  image,
  context = "/tmp",
  instructions = [],
}: {
  image: string;
  context?: string;
  instructions?: Instructions;
}) => Snapshot.make({ image: Image.make(image), context, instructions });

export const Scratch = make({ image: Image.make("scratch") });
