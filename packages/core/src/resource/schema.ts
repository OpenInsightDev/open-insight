import { Schema } from "effect";
import * as Network from "./network.ts";

export const NonNegative = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export class Resources extends Schema.Class<Resources>("Resources")({
  /** Number of CPUs allocated to the sandbox. */
  numCPUs: Schema.OptionFromOptionalNullOr(NonNegative),

  /** Number of GPUs allocated to the sandbox. */
  numGPUs: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Memory allocated to the sandbox in MiB. */
  memoryMiB: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Storage allocated to the sandbox in MiB. */
  storageMiB: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Effective network policy applied while the sandbox is running. */
  network: Schema.OptionFromOptionalNullOr(Network.Policy),

  /** Maximum time allowed to build a snapshot, in seconds. */
  buildTimeoutSec: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Maximum time allowed for the sandbox to run, in seconds. */
  runTimeoutSec: Schema.OptionFromOptionalNullOr(NonNegativeInt),
}) {}

export type Options = Partial<Resources>;
