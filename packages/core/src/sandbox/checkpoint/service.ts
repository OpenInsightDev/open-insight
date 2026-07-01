import { Context, Effect } from "effect";
import type { SandboxError } from "../error.ts";
import type { Sandbox } from "../sandbox/index.ts";
import type { Snapshot } from "../snapshot/index.ts";

export type Checkpoint = Readonly<{
  /**
   * Capture the current filesystem state of a running sandbox as a new
   * snapshot.
   *
   * The returned snapshot is tagged by content hash and can be used with
   * Provider.runSandbox to create new sandboxes from this checkpointed
   * state.
   *
   * Note: Checkpoint snapshots are runtime captures and should not be used
   * with Provider.ensureSnapshot, which would rebuild from the original
   * Containerfile and lose the checkpoint state.
   */
  commit(
    options: Readonly<{
      sandbox: Sandbox;
    }>,
  ): Effect.Effect<Snapshot, SandboxError>;
}>;

export class CheckpointService extends Context.Service<CheckpointService, Checkpoint>()(
  "sandbox/CheckpointService",
) {}
