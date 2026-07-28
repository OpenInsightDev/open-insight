import { Effect, Schema } from "effect";
import * as Limit from "./limit.ts";
import * as Network from "./network.ts";

export class Resources extends Schema.Class<Resources>("Resources")({
  /** Number of CPUs allocated to the sandbox. Defaults to 1. */
  numCPUs: Limit.NonNegative.pipe(Schema.withConstructorDefault(Effect.succeed(1))),

  /** Number of GPUs allocated to the sandbox. Defaults to 0. */
  numGPUs: Limit.NonNegativeInt.pipe(Schema.withConstructorDefault(Effect.succeed(0))),

  /** Memory allocated to the sandbox in MiB. Defaults to 512. */
  memoryMiB: Limit.NonNegativeInt.pipe(Schema.withConstructorDefault(Effect.succeed(512))),

  /** Storage allocated to the sandbox in MiB. Defaults to 1024. */
  storageMiB: Limit.NonNegativeInt.pipe(Schema.withConstructorDefault(Effect.succeed(1024))),

  /** Effective network policy applied while the sandbox is running. Defaults to public. */
  network: Network.Policy.pipe(Schema.withConstructorDefault(Effect.sync(Network.publicAccess))),

  /** Maximum time allowed to build a snapshot, in seconds. Defaults to 120. */
  buildTimeoutSec: Limit.NonNegativeInt.pipe(Schema.withConstructorDefault(Effect.succeed(120))),

  /** Maximum time allowed for the sandbox to run, in seconds. Defaults to 600. */
  runTimeoutSec: Limit.NonNegativeInt.pipe(Schema.withConstructorDefault(Effect.succeed(600))),
}) {}
