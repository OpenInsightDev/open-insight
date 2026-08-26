import { Prompt, Response } from "@open-insight/core/internal";
import { Schema, Stream } from "effect";
import { type Tool } from "effect/unstable/ai";
import { MetricError } from "../error.ts";
import { Metadata } from "../schema.ts";

export type Metric<ID extends string, S extends Schema.Constraint> = Readonly<{
  id: ID;
  schema: S;
  metadata: Metadata;

  transform: <Tools extends Record<string, Tool.Any>, E, R>(
    stream: Stream.Stream<Prompt.Prompt | Response.PartView<Tools>, E, R>,
  ) => Stream.Stream<S["Type"], E | MetricError, R>;
}>;
export type Any = Metric<any, any>;
