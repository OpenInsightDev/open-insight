import { Context, Effect, type Scope } from "effect";
import type { Error } from "./error.ts";
import type { Resources } from "./resource.ts";
import type { Sandbox } from "./sandbox/index.ts";
import * as Snapshot from "@/snapshot/index.ts";

export type Provider = Readonly<{
  /**
   * Acquire a handle to a snapshot, which can be used to run a sandbox or derive a new snapshot.
   *
   * The handle refers to a snapshot that is guaranteed to exist in the provider's storage during the scope.
   *
   * @argument cache - If false, the provider will not cache the snapshot and will remove it from storage when the scope ends.
   */
  aquireSnapshot(
    options: Readonly<{
      snapshot: Snapshot.Snapshot;
      cache?: boolean;
    }>,
  ): Effect.Effect<Snapshot.Handle.Handle, Error, Scope.Scope>;

  /**
   * Derive a new snapshot handle from an existing handle with a set of instructions.
   *
   * The derived one is directly built from the given handle.
   */
  deriveSnapshot(
    options: Readonly<{
      handle: Snapshot.Handle.Handle;
      instructions: Snapshot.Instructions;
      context: string;
      cache?: boolean;
    }>,
  ): Effect.Effect<Snapshot.Handle.Handle, Error, Scope.Scope>;

  /**
   * Run a sandbox with the given snapshot handle.
   */
  runSandbox(
    options: Readonly<{
      handle: Snapshot.Handle.Handle;
      resources: Resources;
    }>,
  ): Effect.Effect<Sandbox, Error, Scope.Scope>;
}>;

export class ProviderService extends Context.Service<ProviderService, Provider>()(
  "sandbox/ProviderService",
) {}
