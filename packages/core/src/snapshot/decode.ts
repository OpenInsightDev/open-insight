import {
  Cmd,
  Copy,
  DockerfileParser,
  Entrypoint,
  Env,
  type Instruction as DockerfileInstruction,
  Run,
  User,
  Workdir,
} from "dockerfile-ast";
import { Effect, Option, Schema, SchemaGetter, SchemaIssue } from "effect";
import { Instruction, Instructions } from "./inst.ts";
import { ParsedContainerfile } from "./build.ts";
import * as Image from "./image.ts";

const encodeInstruction = (instruction: Instruction): string =>
  Instruction.match(instruction, {
    Workdir: ({ path }) => `WORKDIR ${path}`,
    User: ({ user }) => `USER ${user}`,
    Run: ({ cmd }) => `RUN ${cmd}`,
    Env: ({ env }) => {
      const keys = Object.keys(env).sort();
      return `ENV ${keys.map((key) => `${key}=${env[key]}`).join(" ")}`;
    },
    Copy: ({ src, dest }) => `COPY ${JSON.stringify([...src, dest])}`,
    Cmd: ({ cmd }) => `CMD ${JSON.stringify(cmd)}`,
    Entrypoint: ({ cmd }) => `ENTRYPOINT ${JSON.stringify(cmd)}`,
  });

const invalidContainerfile = (containerfile: string, message: string) =>
  new SchemaIssue.InvalidValue(Option.some(containerfile), { message });

const requireArguments = Effect.fn("containerfile/requireArguments")(function* (
  containerfile: string,
  instruction: DockerfileInstruction,
) {
  const argumentsContent = instruction.getArgumentsContent();
  if (argumentsContent === null) {
    return yield* Effect.fail(
      invalidContainerfile(
        containerfile,
        `${instruction.getKeyword()} instruction is missing arguments`,
      ),
    );
  }
  return argumentsContent;
});

const requireNoFlags = Effect.fn("containerfile/requireNoFlags")(function* (
  containerfile: string,
  instruction: Run | Copy | Cmd | Entrypoint,
) {
  if (instruction.getFlags().length !== 0) {
    return yield* Effect.fail(
      invalidContainerfile(
        containerfile,
        `${instruction.getKeyword()} flags are not supported by ParsedContainerfile`,
      ),
    );
  }
});

const decodeJsonArguments = Effect.fn("containerfile/decodeJsonArguments")(function* (
  containerfile: string,
  instruction: Cmd | Entrypoint,
) {
  const openingBracket = instruction.getOpeningBracket();
  const closingBracket = instruction.getClosingBracket();
  if (openingBracket === null || closingBracket === null) {
    return yield* Effect.fail(
      invalidContainerfile(containerfile, `${instruction.getKeyword()} must use JSON array form`),
    );
  }
  return instruction.getJSONStrings().map((argument) => argument.getJSONValue());
});

const decodeCopyArguments = Effect.fn("containerfile/decodeCopyArguments")(function* (
  containerfile: string,
  instruction: Copy,
) {
  const openingBracket = instruction.getOpeningBracket();
  const closingBracket = instruction.getClosingBracket();
  if (openingBracket === null && closingBracket === null) {
    return instruction.getArguments().map((argument) => argument.getValue());
  }
  if (openingBracket !== null && closingBracket !== null) {
    return instruction.getJSONStrings().map((argument) => argument.getJSONValue());
  }
  return yield* Effect.fail(
    invalidContainerfile(containerfile, "COPY has an incomplete JSON array"),
  );
});

const decodeInstruction = Effect.fn("containerfile/decodeInstruction")(function* (
  containerfile: string,
  instruction: DockerfileInstruction,
) {
  if (instruction instanceof Workdir) {
    return Instruction.make({
      _tag: "Workdir",
      path: yield* requireArguments(containerfile, instruction),
    });
  }

  if (instruction instanceof User) {
    return Instruction.make({
      _tag: "User",
      user: yield* requireArguments(containerfile, instruction),
    });
  }

  if (instruction instanceof Run) {
    yield* requireNoFlags(containerfile, instruction);
    return Instruction.make({
      _tag: "Run",
      cmd: yield* requireArguments(containerfile, instruction),
    });
  }

  if (instruction instanceof Env) {
    const env: Record<string, string> = {};
    for (const property of instruction.getProperties()) {
      const key = property.getName();
      const value = property.getValue();
      if (value === null) {
        return yield* Effect.fail(
          invalidContainerfile(containerfile, `ENV ${key} is missing a value`),
        );
      }
      env[key] = value;
    }
    return Instruction.make({ _tag: "Env", env });
  }

  if (instruction instanceof Copy) {
    yield* requireNoFlags(containerfile, instruction);
    const argumentsContent = yield* decodeCopyArguments(containerfile, instruction);
    if (argumentsContent.length < 2) {
      return yield* Effect.fail(
        invalidContainerfile(
          containerfile,
          "COPY must include at least one source and one destination",
        ),
      );
    }
    return Instruction.make({
      _tag: "Copy",
      src: argumentsContent.slice(0, -1),
      dest: argumentsContent[argumentsContent.length - 1],
    });
  }

  if (instruction instanceof Cmd) {
    yield* requireNoFlags(containerfile, instruction);
    return Instruction.make({
      _tag: "Cmd",
      cmd: yield* decodeJsonArguments(containerfile, instruction),
    });
  }

  if (instruction instanceof Entrypoint) {
    yield* requireNoFlags(containerfile, instruction);
    return Instruction.make({
      _tag: "Entrypoint",
      cmd: yield* decodeJsonArguments(containerfile, instruction),
    });
  }

  return yield* Effect.fail(
    invalidContainerfile(
      containerfile,
      `${instruction.getKeyword()} instruction is not supported by ParsedContainerfile`,
    ),
  );
});

const decodeContainerfile = Effect.fn("containerfile")(function* (containerfile: string) {
  const dockerfile = yield* Effect.try({
    try: () => DockerfileParser.parse(containerfile),
    catch: (cause) =>
      invalidContainerfile(containerfile, `Failed to parse Containerfile: ${String(cause)}`),
  });

  const froms = dockerfile.getFROMs();
  if (froms.length !== 1) {
    return yield* Effect.fail(
      invalidContainerfile(
        containerfile,
        `Expected exactly one FROM instruction, found ${froms.length}`,
      ),
    );
  }

  const image = froms[0].getImage();
  if (image === null) {
    return yield* Effect.fail(
      invalidContainerfile(containerfile, "FROM instruction is missing an image"),
    );
  }

  const instructions: Array<Instruction> = [];
  for (const instruction of dockerfile.getInstructions()) {
    if (instruction === froms[0]) {
      continue;
    }
    instructions.push(yield* decodeInstruction(containerfile, instruction));
  }

  return { image: Image.make(image), instructions };
});

export const Containerfile = Schema.String.pipe(
  Schema.decodeTo(ParsedContainerfile, {
    decode: SchemaGetter.transformOrFail(decodeContainerfile),
    encode: SchemaGetter.transform(({ image, instructions }) => {
      const lines = [`FROM ${image}`, ...instructions.map(encodeInstruction)];
      return `${lines.join("\n")}\n`;
    }),
  }),
);

export const encode = (containerfile: { image: string; instructions: Instructions }) =>
  Schema.encodeEffect(Containerfile)({
    image: Image.make(containerfile.image),
    instructions: containerfile.instructions,
  });
export const encodeSync = (containerfile: { image: string; instructions: Instructions }) =>
  Schema.encodeSync(Containerfile)({
    image: Image.make(containerfile.image),
    instructions: containerfile.instructions,
  });

export const decode = (containerfile: string) => Schema.decodeEffect(Containerfile)(containerfile);
export const decodeSync = (containerfile: string) =>
  Schema.decodeSync(Containerfile)(containerfile);
