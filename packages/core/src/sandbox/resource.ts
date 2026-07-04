import { Schema } from "effect";

const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export class ResourceLimits extends Schema.Class<ResourceLimits>("ResourceLimits")({
  numCPUs: Schema.optional(NonNegativeNumber),
  numGPUs: Schema.optional(NonNegativeInt),
  memoryMiB: Schema.optional(NonNegativeInt),
  storageMiB: Schema.optional(NonNegativeInt),
  internet: Schema.optional(Schema.Boolean),
  buildTimeoutSec: Schema.optional(NonNegativeInt),
  runTimeoutSec: Schema.optional(NonNegativeInt),
}) {
  static default = this.make({
    numCPUs: 1,
    numGPUs: 0,
    memoryMiB: 512,
    storageMiB: 1024,
    internet: false,
    buildTimeoutSec: 120,
    runTimeoutSec: 360,
  });
}
