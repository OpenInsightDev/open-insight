import { Context, Effect, type Scope } from "effect";
import type * as SandboxContext from "../context/index.ts";
import type { SandboxError } from "../error.ts";
import type { ResourceLimits } from "../resource.ts";
import type { Sandbox } from "../sandbox/index.ts";
import type { Instructions } from "../snapshot/inst.ts";
import type { Handle, Snapshot } from "../snapshot/index.ts";

export type Provider = Readonly<{
  /**
   * Ensure that the given snapshot exists in the provider's storage.
   *
   * The snapshot must be indexed with the hash of the snapshot's containerfile.
   */
  // ensureSnapshot(
  //   options: Readonly<{
  //     snapshot: Snapshot;
  //     context: SandboxContext.Context;
  //   }>,
  // ): Effect.Effect<void, SandboxError>;

  /**
   * Derive a new snapshot from an existing snapshot and a set of instructions.
   *
   * The new snapshot must be indexed with the hash of the derived snapshot's containerfile.
   */
  // deriveSnapshot(
  //   options: Readonly<{
  //     snapshot: Snapshot;
  //     context: SandboxContext.Context;
  //     instructions: Instructions;
  //   }>,
  // ): Effect.Effect<void, SandboxError>;

  /**
   * Remove a snapshot from the provider's storage.
   */
  // removeSnapshot(
  //   options: Readonly<{
  //     snapshot: Snapshot;
  //   }>,
  // ): Effect.Effect<void, SandboxError>;

  /**
   * Run a sandbox with the given snapshot.
   *
   * The sandbox is scoped and will be automatically cleaned up.
   */
  // runSandbox(
  //   options: Readonly<{
  //     snapshot: Snapshot;
  //     resources: ResourceLimits | null;
  //   }>,
  // ): Effect.Effect<Sandbox, SandboxError, Scope.Scope>;

  /**
   * Acquire a handle to a snapshot, which can be used to run a sandbox or derive a new snapshot.
   *
   * The handle refers to a snapshot that is guaranteed to exist in the provider's storage during the scope.
   *
   * @argument cache - If false, the provider will not cache the snapshot and will remove it from storage when the scope ends.
   */
  aquireSnapshot(
    options: Readonly<{
      snapshot: Snapshot;
      context: SandboxContext.Context;
      cache: boolean;
    }>,
  ): Effect.Effect<Handle.Handle, SandboxError, Scope.Scope>;

  /**
   * Derive a new snapshot handle from an existing handle with a set of instructions.
   *
   * The derived one is directly built from the given handle.
   */
  deriveSnapshot(
    options: Readonly<{
      handle: Handle.Handle;
      instructions: Instructions;
      context: SandboxContext.Context;
    }>,
  ): Effect.Effect<Handle.Handle, SandboxError, Scope.Scope>;

  /**
   * Run a sandbox with the given snapshot handle.
   *
   * @argument resources - Resource limits for the sandbox. If not provided, the sandbox will run with default resource limits.
   */
  runSandbox(
    options: Readonly<{
      handle: Handle.Handle;
      resources?: ResourceLimits;
    }>,
  ): Effect.Effect<Sandbox, SandboxError, Scope.Scope>;
}>;

export class ProviderService extends Context.Service<ProviderService, Provider>()(
  "sandbox/ProviderService",
) {}
