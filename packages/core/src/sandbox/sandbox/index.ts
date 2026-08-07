import { Context, Effect, Crypto } from "effect";
import { SandboxError } from "../error.ts";
import { type Command, type Handle, type Spawn } from "./service.ts";

export const SANDBOX_NAME = "open-insight-sandbox";

export const makeName = Effect.fn(function* () {
  const crypto = yield* Crypto.Crypto;
  const hash = yield* crypto.randomUUIDv4;
  return `${SANDBOX_NAME}-${hash}`;
});

export type Sandbox = Spawn &
  Readonly<{
    cmd(process: Command): Effect.Effect<Handle, SandboxError>;
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
      options: Readonly<{ sandboxPort: number }>,
    ): Effect.Effect<{ hostUrl: string }, SandboxError>;
  }>;

export class Current extends Context.Service<Current, Sandbox>()("sandbox/Current") {}

export * from "./promise.ts";
export * from "./service.ts";
