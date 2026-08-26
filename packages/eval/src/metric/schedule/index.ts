import { DateTime, Effect, Schema, Stream } from "effect";
import { Sandbox } from "@open-insight/core/internal";
import type { MetricError } from "../error.ts";
import type { Metadata } from "../schema.ts";

export type Metric<ID extends string, S extends Schema.Constraint> = Readonly<{
  id: ID;
  schema: S;
  metadata: Metadata;

  repeat: Effect.Repeat.Options<unknown>;
  transform: (
    context: Readonly<{
      sandbox: Sandbox.ReadonlySandbox;
      stream: Stream.Stream<DateTime.DateTime, unknown>;
    }>,
  ) => Stream.Stream<S["Type"], MetricError>;
}>;
