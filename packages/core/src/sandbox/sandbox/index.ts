import { Crypto, Effect } from "effect";
import { Error } from "../error.ts";
import { type Command, type Handle, type Spawn } from "./service.ts";

export const SANDBOX_NAME = "open-insight-sandbox";

export const makeName = Effect.fn(function* () {
  const crypto = yield* Crypto.Crypto;
  const id = yield* crypto.randomUUIDv4;
  return `${SANDBOX_NAME}-${id}`;
});

export type Sandbox = Spawn &
  Readonly<{
    cmd(process: Command): Effect.Effect<Handle, Error>;
    readFile(options: Readonly<{ sandboxPath: string }>): Effect.Effect<string, Error>;
    writeFile(
      options: Readonly<{ sandboxPath: string; content: string }>,
    ): Effect.Effect<void, Error>;
    download(
      options: Readonly<{ sandboxPath: string; hostPath: string }>,
    ): Effect.Effect<void, Error>;
    upload(
      options: Readonly<{ sandboxPath: string; hostPath: string }>,
    ): Effect.Effect<void, Error>;
    expose(
      options: Readonly<{ sandboxPort: number; hostPort?: number }>,
    ): Effect.Effect<{ hostUrl: string }, Error>;
  }>;

export * from "./promise.ts";
export * from "./service.ts";
