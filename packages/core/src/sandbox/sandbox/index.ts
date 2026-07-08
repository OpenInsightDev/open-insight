import { Crypto, Effect, Match, Stream } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { Spawn } from "@/utils/index.ts";
import { Error } from "../error.ts";

export const SANDBOX_NAME = "open-insight-sandbox";

export const makeName = Effect.fn(function* () {
  const crypto = yield* Crypto.Crypto;
  const id = yield* crypto.randomUUIDv4;
  return `${SANDBOX_NAME}-${id}`;
});

export type Sandbox = Readonly<{
  $(process: CP.Command): Effect.Effect<string, Error>;
  readFile(options: Readonly<{ sandboxPath: string }>): Effect.Effect<string, Error>;
  writeFile(
    options: Readonly<{ sandboxPath: string; content: string }>,
  ): Effect.Effect<void, Error>;
  download(
    options: Readonly<{ sandboxPath: string; hostPath: string }>,
  ): Effect.Effect<void, Error>;
  upload(options: Readonly<{ sandboxPath: string; hostPath: string }>): Effect.Effect<void, Error>;
  expose(
    options: Readonly<{ sandboxPort: number; hostPort: number }>,
  ): Effect.Effect<{ hostUrl: string }, Error>;
}>;

export type MakeSandboxOptions = Readonly<{
  $(process: CP.StandardCommand, stdin?: string): Effect.Effect<string, Error>;
  expose: Sandbox["expose"];

  download: Sandbox["download"] | "rsync";
  upload: Sandbox["upload"] | "rsync";
  readFile: Sandbox["readFile"] | "cat";
  writeFile: Sandbox["writeFile"] | "tee";
}>;

export const make = Effect.fn(function* ({
  $: sandbox$,
  expose,
  download,
  upload,
  readFile,
  writeFile,
}: MakeSandboxOptions): Effect.fn.Return<Sandbox, Error, Spawn.SpawnService> {
  const spawner = yield* Spawn.SpawnService;

  // TODO supports Assertions

  const $ = Effect.fn(function* (
    command: CP.Command,
    input?: string,
  ): Effect.fn.Return<string, Error> {
    return yield* Match.value(command).pipe(
      Match.tag("StandardCommand", (cmd) => sandbox$(cmd, input)),
      Match.tag("PipedCommand", (cmd) =>
        Effect.gen(function* () {
          const output = yield* $(cmd.left, input);
          return yield* $(cmd.right, output);
        }),
      ),
      Match.exhaustive,
    );
  });

  const readFileImpl: Sandbox["readFile"] =
    readFile === "cat"
      ? Effect.fn(function* ({ sandboxPath }) {
          return yield* $(CP.make`cat ${sandboxPath}`);
        })
      : readFile;

  const writeFileImpl: Sandbox["writeFile"] =
    writeFile === "tee"
      ? Effect.fn(function* ({ sandboxPath, content }) {
          yield* $(CP.make`tee ${sandboxPath}`, content);
        })
      : writeFile;

  const downloadImpl: Sandbox["download"] =
    download === "rsync"
      ? Effect.fn(function* ({ sandboxPath, hostPath }) {
          const content = yield* $(CP.make`cat ${sandboxPath}`);
          yield* spawner
            .string(
              CP.make("tee", [hostPath], {
                stdin: {
                  stream: Stream.make(content).pipe(Stream.encodeText),
                },
              } satisfies CP.CommandOptions),
            )
            .pipe(
              Effect.mapError((e) =>
                Error.sandboxExec("host", `download ${sandboxPath} -> ${hostPath}`)(e),
              ),
            );
        })
      : download;

  const uploadImpl: Sandbox["upload"] =
    upload === "rsync"
      ? Effect.fn(function* ({ sandboxPath, hostPath }) {
          const content = yield* spawner
            .string(CP.make`cat ${hostPath}`)
            .pipe(
              Effect.mapError((e) =>
                Error.sandboxExec("host", `upload ${hostPath} -> ${sandboxPath}`)(e),
              ),
            );
          yield* $(CP.make`tee ${sandboxPath}`, content);
        })
      : upload;

  return {
    $,
    readFile: readFileImpl,
    writeFile: writeFileImpl,
    download: downloadImpl,
    upload: uploadImpl,
    expose,
  } satisfies Sandbox;
});

export * from "./promise.ts";
