import { Schema } from "effect";
import * as Network from "./network.ts";

export const NonNegative = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export class Resources extends Schema.Class<Resources>("Resources")({
  /**
   * Number of CPUs allocated to the sandbox.
   *
   * Can be a fractional number, e.g. 0.5 for half a CPU.
   *
   * Note: Fractional CPU allocation behaves varies across different sandbox providers.
   */
  numCPUs: Schema.OptionFromOptionalNullOr(NonNegative),

  /** Number of GPUs allocated to the sandbox. */
  numGPUs: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Memory allocated to the sandbox in MiB. */
  memoryMiB: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Storage allocated to the sandbox in MiB. */
  storageMiB: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /**
   * Effective network policy applied while the sandbox is running.
   *
   * Use the `no-network` policy to disable network access entirely.
   */
  network: Schema.OptionFromOptionalNullOr(Network.Policy),

  /** Maximum time allowed to build a snapshot, in seconds. */
  buildTimeoutSec: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Maximum time allowed for the sandbox to run, in seconds. */
  runTimeoutSec: Schema.OptionFromOptionalNullOr(NonNegativeInt),
}) {}

/** Parameters accepted by `Resource.make`; simple network modes are passed as a plain string. */
export type MakeOptions = {
  numCPUs?: number;
  numGPUs?: number;
  memoryMiB?: number;
  storageMiB?: number;
  network?:
    | Exclude<Network.Mode, "allowlist">
    | Readonly<{ allowlist: ReadonlyArray<Network.AllowedHost> }>;
  buildTimeoutSec?: number;
  runTimeoutSec?: number;
};

export const make = (options: MakeOptions = {}): Resources => {
  const { network, ...rest } = options;
  return Schema.decodeSync(Resources)({
    ...rest,
    ...(network === undefined
      ? {}
      : {
          network:
            typeof network === "string"
              ? { mode: network, allowedHosts: [] }
              : { mode: "allowlist", allowedHosts: network.allowlist },
        }),
  });
};
