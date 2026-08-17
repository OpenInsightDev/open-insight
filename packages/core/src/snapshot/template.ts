import { Crypto, Effect, Encoding, FileSystem, Path, Schema } from "effect";
import { SnapshotError } from "./error.ts";
import { cmd, Instruction, Instructions } from "./inst.ts";

const OciImageReference =
  /^(?:(?<domain>[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)(?::(?<port>\d+))?\/)?(?<repository>[a-z0-9]+(?:(?:[._]|__|[-]*)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|[-]*)[a-z0-9]+)*)*)(?::(?<tag>[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}))?(?:@(?<digest>[a-zA-Z0-9-_]+:[a-fA-F0-9]{32,}))?$/;

export const Image = Schema.String.pipe(Schema.brand("Image"));
export type Image = Schema.Schema.Type<typeof Image>;

export const FromString = Schema.String.check(
  Schema.isPattern(OciImageReference, { expected: "a valid OCI image reference" }),
).pipe(Schema.decodeTo(Image));

const makeImage = (image: string): Image => Image.make(image);

// Sandbox environments only allow `sleep` as the default command.
const defaultCommand = cmd("sleep", "infinity");

/** A template described with the provider-independent instruction set. */
export class InstructionsTemplate extends Schema.TaggedClass<InstructionsTemplate>()(
  "Instructions",
  {
    image: FromString,
    instructions: Instructions,
    /** Absolute build-context directory on the host machine. */
    context: Schema.String,
  },
) {}

/** A template described by a Dockerfile or Containerfile on the user's machine. */
export class ContainerfileTemplate extends Schema.TaggedClass<ContainerfileTemplate>()(
  "Containerfile",
  {
    /** Absolute path to the Dockerfile or Containerfile on the host machine. */
    filePath: Schema.String,
    /** Absolute build-context directory on the host machine. */
    context: Schema.String,
  },
) {}

export const Template = Schema.Union([InstructionsTemplate, ContainerfileTemplate]);
export type Template = Schema.Schema.Type<typeof Template>;

export const isInstructions = Schema.is(InstructionsTemplate);
export const isContainerfile = Schema.is(ContainerfileTemplate);

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
export const writeInstructions = Effect.fn(function* (template: InstructionsTemplate) {
  const fs = yield* FileSystem.FileSystem;
  const containerfilePath = yield* fs.makeTempFile({
    prefix: "open-insight-",
    suffix: ".Containerfile",
  });
  yield* fs.writeFileString(containerfilePath, encode(template));
  return containerfilePath;
});

export const hash = Effect.fn(
  function* (template: Template) {
    const crypto = yield* Crypto.Crypto;
    const source = isInstructions(template)
      ? JSON.stringify({ containerfile: encode(template), context: template.context })
      : JSON.stringify({ filePath: template.filePath, context: template.context });
    const bytes = new TextEncoder().encode(source);
    const digest = yield* crypto.digest("SHA-256", bytes);
    return Encoding.encodeHex(digest);
  },
  (effect, template): Effect.Effect<string, Error, Crypto.Crypto> =>
    effect.pipe(Effect.mapError(SnapshotError.build(template))),
);

/** Extend an instruction template after its existing instructions. */
export const extend =
  (instructions: Instructions) =>
  (template: InstructionsTemplate): InstructionsTemplate =>
    new InstructionsTemplate({
      image: template.image,
      instructions: [...template.instructions, ...instructions],
      context: template.context,
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

  return new ContainerfileTemplate({
    filePath: resolvedFilePath,
    context: resolvedContext,
  });
});

export type MakeOptions = {
  image: string;
  context?: string;
  instructions: Instructions;
};

/** Create a template from an OCI image reference without build instructions. */
export const fromImage = (image: string): InstructionsTemplate =>
  new InstructionsTemplate({
    image: makeImage(image),
    context: "/tmp",
    instructions: [defaultCommand],
  });

/** Create a template from an OCI image reference and provider-independent instructions. */
export const makeTemplate = ({
  image,
  context = "/tmp",
  instructions,
}: MakeOptions): InstructionsTemplate =>
  new InstructionsTemplate({
    image: makeImage(image),
    context,
    instructions: [...instructions, defaultCommand],
  });

export const Scratch = fromImage("scratch");
export const Alpine = fromImage("alpine:latest");
export const Debian = fromImage("debian:latest");
