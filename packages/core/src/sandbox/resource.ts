import { Effect, Schema } from "effect";

/**
 * Marker schema used to represent that a resource should not be practically limited.
 */
export const Unlimited = Schema.Literal("unlimited").pipe(Schema.brand("Unlimited"));
export type Unlimited = Schema.Schema.Type<typeof Unlimited>;
export const isUnlimited = Schema.is(Unlimited);

const UnlimitedNumber = Schema.Union([
  Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  Unlimited,
]);
const UnlimitedInt = Schema.Union([Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), Unlimited]);

export class Resources extends Schema.Class<Resources>("Resources")({
  /**
   * The number of CPUs allocated to the sandbox.
   *
   * Can be a non-negative number, allowing for fractional CPU allocation if supported (e.g., 0.5 for half a CPU),
   * or `"unlimited"` to avoid applying an explicit CPU limit.
   *
   * Defaults to `1`.
   */
  numCPUs: UnlimitedNumber.pipe(Schema.withConstructorDefault(Effect.succeed(1))),

  /**
   * The number of GPUs allocated to the sandbox, or `"unlimited"` to avoid applying an explicit GPU limit.
   *
   * Defaults to `0`.
   */
  numGPUs: UnlimitedInt.pipe(Schema.withConstructorDefault(Effect.succeed(0))),

  /**
   * The amount of memory allocated to the sandbox in MiB (Mebibytes), or `"unlimited"` to avoid applying
   * an explicit memory limit.
   *
   * Defaults to `512`.
   */
  memoryMiB: UnlimitedInt.pipe(Schema.withConstructorDefault(Effect.succeed(512))),

  /**
   * The amount of storage allocated to the sandbox in MiB (Mebibytes), or `"unlimited"` to avoid applying
   * an explicit storage limit.
   *
   * Defaults to `1024`.
   */
  storageMiB: UnlimitedInt.pipe(Schema.withConstructorDefault(Effect.succeed(1024))),

  /**
   * Whether the sandbox has internet access enabled.
   *
   * If set to true, the sandbox can access external networks.
   *
   * Defaults to `false`.
   */
  // TODO fine-grained network access control
  network: Schema.Boolean.pipe(Schema.withConstructorDefault(Effect.succeed(false))),

  /**
   * The maximum time allowed for sandbox providers to build the snapshot before running sandbox,
   * or `"unlimited"` to disable the practical limit.
   *
   * Defaults to `120`.
   */
  buildTimeoutSec: UnlimitedInt.pipe(Schema.withConstructorDefault(Effect.succeed(120))),

  /**
   * The maximum time allowed for the sandbox to run before being terminated,
   * or `"unlimited"` to disable the practical limit.
   *
   * Defaults to `600`.
   */
  runTimeoutSec: UnlimitedInt.pipe(Schema.withConstructorDefault(Effect.succeed(600))),
}) {
  /**
   * Default resource limits for a sandbox.
   */
  static default = this.make({});
}
