import { Crypto, Effect, Encoding, FileSystem, Path, Schema } from "effect";
import { SnapshotError } from "./error.ts";
import * as Image from "./image.ts";
import { cmd, Instruction, Instructions } from "./inst.ts";

// Sandbox environments only allow `sleep` as the default command.
const defaultCommand = cmd("sleep", "infinity");

/** A snapshot described with the provider-independent instruction set. */
export class InstructionsSnapshot extends Schema.TaggedClass<InstructionsSnapshot>()(
  "Instructions",
  {
    image: Image.FromString,
    instructions: Instructions,
    /** Absolute build-context directory on the host machine. */
    context: Schema.String,
  },
) {}

/** A snapshot described by a Dockerfile or Containerfile on the user's machine. */
export class ContainerfileSnapshot extends Schema.TaggedClass<ContainerfileSnapshot>()(
  "Containerfile",
  {
    /** Absolute path to the Dockerfile or Containerfile on the host machine. */
    filePath: Schema.String,
    /** Absolute build-context directory on the host machine. */
    context: Schema.String,
  },
) {}

export const Snapshot = Schema.Union([InstructionsSnapshot, ContainerfileSnapshot]);
export type Snapshot = Schema.Schema.Type<typeof Snapshot>;

export const isInstructions = Schema.is(InstructionsSnapshot);
export const isContainerfile = Schema.is(ContainerfileSnapshot);

/**
 * The name of the snapshot.
 *
 * Each snapshot must use this name and mapped to different hash tags.
 */
export const SNAPSHOT_NAME = "open-insight-snapshot";

const encodeInstruction = (instruction: Instruction): string =>
  Instruction.match(instruction, {
    Workdir: ({ path }) => `WORKDIR ${path}`,
    User: ({ user }) => `USER ${user}`,
    Run: ({ cmd, network }) => `RUN${network === undefined ? "" : ` --network=${network}`} ${cmd}`,
    Cmd: ({ cmd }) => `CMD ${JSON.stringify(cmd)}`,
    Env: ({ env }) => {
      const keys = Object.keys(env).sort();
      return `ENV ${keys.map((key) => `${key}=${JSON.stringify(env[key])}`).join(" ")}`;
    },
    Copy: ({ src, dest, from, chmod, chown, link, parents, exclude }) => {
      const options = [
        from === undefined ? undefined : `--from=${from}`,
        chmod === undefined ? undefined : `--chmod=${chmod}`,
        chown === undefined ? undefined : `--chown=${chown}`,
        link === undefined ? undefined : `--link${link ? "" : "=false"}`,
        parents === undefined ? undefined : `--parents${parents ? "" : "=false"}`,
        ...(exclude ?? []).map((pattern) => `--exclude=${pattern}`),
      ].filter((option): option is string => option !== undefined);
      const prefix = options.length === 0 ? "" : `${options.join(" ")} `;
      return `COPY ${prefix}${JSON.stringify([...src, dest])}`;
    },
  });

/** Encode provider-independent instructions as a Containerfile. */
export const encode = ({
  image,
  instructions,
}: Readonly<{
  image: string;
  instructions: Instructions;
}>): string => {
  const lines = [`FROM ${image}`, ...instructions.map(encodeInstruction)];
  return `${lines.join("\n")}\n`;
};

/** Write provider-independent instructions to a temporary Containerfile and return its path. */
export const writeInstructions = Effect.fn(function* (snapshot: InstructionsSnapshot) {
  const fs = yield* FileSystem.FileSystem;
  const containerfilePath = yield* fs.makeTempFile({
    prefix: "open-insight-",
    suffix: ".Containerfile",
  });
  yield* fs.writeFileString(containerfilePath, encode(snapshot));
  return containerfilePath;
});

export const hash = Effect.fn(
  function* (snapshot: Snapshot) {
    const crypto = yield* Crypto.Crypto;
    const source = isInstructions(snapshot)
      ? JSON.stringify({ containerfile: encode(snapshot), context: snapshot.context })
      : JSON.stringify({ filePath: snapshot.filePath, context: snapshot.context });
    const bytes = new TextEncoder().encode(source);
    const digest = yield* crypto.digest("SHA-256", bytes);
    return Encoding.encodeHex(digest);
  },
  (effect, snapshot): Effect.Effect<string, Error, Crypto.Crypto> =>
    effect.pipe(Effect.mapError(SnapshotError.build(snapshot))),
);

/** Extend an instruction snapshot after its existing instructions. */
export const extend =
  (instructions: Instructions) =>
  (snapshot: InstructionsSnapshot): InstructionsSnapshot =>
    new InstructionsSnapshot({
      image: snapshot.image,
      instructions: [...snapshot.instructions, ...instructions],
      context: snapshot.context,
    });

export const build = Effect.fn(function* ({
  filePath,
  context,
}: {
  filePath: string;
  context?: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolvedFilePath = yield* fs.realPath(path.resolve(filePath));
  const containerfile = yield* fs.readFileString(resolvedFilePath);
  yield* fs.writeFileString(
    resolvedFilePath,
    `${containerfile}${containerfile.endsWith("\n") ? "" : "\n"}${encodeInstruction(defaultCommand)}\n`,
  );
  const resolvedContext =
    context === undefined
      ? path.dirname(resolvedFilePath)
      : yield* fs.realPath(path.resolve(context));

  return new ContainerfileSnapshot({
    filePath: resolvedFilePath,
    context: resolvedContext,
  });
});

export type MakeOptions = {
  image: string;
  context?: string;
  instructions: Instructions;
};

/** Create a snapshot from an OCI image reference without build instructions. */
export const make = (image: string): InstructionsSnapshot =>
  new InstructionsSnapshot({
    image: Image.make(image),
    context: "/tmp",
    instructions: [defaultCommand],
  });

/** Create a snapshot from an OCI image reference and provider-independent instructions. */
export const makeWith = ({
  image,
  context = "/tmp",
  instructions,
}: MakeOptions): InstructionsSnapshot =>
  new InstructionsSnapshot({
    image: Image.make(image),
    context,
    instructions: [...instructions, defaultCommand],
  });

export const Scratch = make("scratch");
