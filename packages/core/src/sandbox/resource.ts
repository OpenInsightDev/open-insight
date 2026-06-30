import { Schema } from "effect";

const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const ResourceLimitsSchema = Schema.Struct({
  numCPUs: Schema.optionalKey(NonNegativeNumber).annotate({
    description:
      "Maximum CPU cores available to the sandbox. Use fractional values such as 0.5 for half a core.",
  }),
  numGPUs: Schema.optionalKey(NonNegativeInt).annotate({
    description: "Maximum GPU devices available to the sandbox.",
  }),
  memoryMiB: Schema.optionalKey(NonNegativeInt).annotate({
    description: "Maximum memory available to the sandbox, in MiB.",
  }),
  diskMiB: Schema.optionalKey(NonNegativeInt).annotate({
    description: "Maximum writable disk space available to the sandbox, in MiB.",
  }),
}).annotate({
  description: "Sandbox resource limit configuration.",
});

export type ResourceLimits = Schema.Schema.Type<typeof ResourceLimitsSchema>;
