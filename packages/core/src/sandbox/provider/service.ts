import { Context, Effect, type Scope } from "effect";
import * as Assert from "../assert/index.ts";
import type * as SandboxContext from "../context/index.ts";
import type { SandboxError } from "../error.ts";
import type { ResourceLimits } from "../resource.ts";
import type { Sandbox } from "../sandbox/index.ts";
import type { Instructions } from "../snapshot/instruction.ts";
import type { Snapshot } from "../snapshot/index.ts";

export type Provider = Readonly<{
  /**
   * Ensure that the given snapshot exists in the provider's storage.
   *
   * The snapshot must be indexed with the hash of the snapshot's containerfile.
   */
  ensureSnapshot(
    options: Readonly<{
      snapshot: Snapshot;
      context: SandboxContext.Context;
    }>,
  ): Effect.Effect<void, SandboxError>;

  /**
   * Derive a new snapshot from an existing snapshot and a set of instructions.
   *
   * The new snapshot must be indexed with the hash of the derived snapshot's containerfile.
   */
  deriveSnapshot(
    options: Readonly<{
      snapshot: Snapshot;
      context: SandboxContext.Context;
      instructions: Instructions;
    }>,
  ): Effect.Effect<void, SandboxError>;

  /**
   * Remove a snapshot from the provider's storage.
   */
  removeSnapshot(
    options: Readonly<{
      snapshot: Snapshot;
    }>,
  ): Effect.Effect<void, SandboxError>;

  /**
   * Run a sandbox with the given snapshot.
   *
   * The sandbox is scoped and will be automatically cleaned up.
   */
  runSandbox(
    options: Readonly<{
      snapshot: Snapshot;
      assert: Assert.Assert | null;
      resources: ResourceLimits | null;
    }>,
  ): Effect.Effect<Sandbox, SandboxError, Scope.Scope>;
}>;

export class ProviderService extends Context.Service<ProviderService, Provider>()(
  "sandbox/ProviderService",
) {}
