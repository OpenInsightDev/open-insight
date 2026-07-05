import { Crypto, Effect, Match, Stream } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { Spawn } from "@/utils/index.ts";
import { SandboxError } from "../error.ts";

export const SANDBOX_NAME = "open-insight-sandbox";

export const makeName = Effect.fn(function* () {
  const crypto = yield* Crypto.Crypto;
  const id = yield* crypto.randomUUIDv4;
  return `${SANDBOX_NAME}-${id}`;
});

export type Sandbox = Readonly<{
  $(process: CP.Command): Effect.Effect<string, SandboxError>;
  readFile(options: Readonly<{ sandboxPath: string }>): Effect.Effect<string, SandboxError>;
  writeFile(
    options: Readonly<{ sandboxPath: string; content: string }>,
  ): Effect.Effect<void, SandboxError>;
  download(
    options: Readonly<{ sandboxPath: string; hostPath: string }>,
  ): Effect.Effect<void, SandboxError>;
  upload(
    options: Readonly<{ sandboxPath: string; hostPath: string }>,
  ): Effect.Effect<void, SandboxError>;
  expose(
    options: Readonly<{ sandboxPort: number; hostPort: number }>,
  ): Effect.Effect<{ hostUrl: string }, SandboxError>;
}>;

export type MakeSandboxOptions = Readonly<{
  $(process: CP.StandardCommand, stdin?: string): Effect.Effect<string, SandboxError>;
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
}: MakeSandboxOptions): Effect.fn.Return<Sandbox, SandboxError, Spawn.SpawnService> {
  const spawner = yield* Spawn.SpawnService;

  // TODO supports Assertions

  const $ = Effect.fn(function* (
    command: CP.Command,
    input?: string,
  ): Effect.fn.Return<string, SandboxError> {
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
                SandboxError.sandboxExec({
                  name: "host",
                  operation: `download ${sandboxPath} -> ${hostPath}`,
                })(e),
              ),
            );
        })
      : download;

  const uploadImpl: Sandbox["upload"] =
    upload === "rsync"
      ? Effect.fn(function* ({ sandboxPath, hostPath }) {
          const content = yield* spawner.string(CP.make`cat ${hostPath}`).pipe(
            Effect.mapError((e) =>
              SandboxError.sandboxExec({
                name: "host",
                operation: `upload ${hostPath} -> ${sandboxPath}`,
              })(e),
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
