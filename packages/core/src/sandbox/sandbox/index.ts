import { Context, Effect, Hash } from "effect";
import { SandboxError } from "../error.ts";
import { type Command, type Handle, type Spawn } from "./service.ts";
import * as Snapshot from "#/snapshot/index.ts";
import { Git } from "#/utils/index.ts";

export const SANDBOX_NAME = "open-insight-sandbox";

export const makeName = Effect.fn(function* (handle: Snapshot.Handle.Handle) {
  const commitHash = yield* Git.commitHash();
  const handleName = handle.name;
  const hash = Hash.hash(`${commitHash}-${handleName}`);
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
