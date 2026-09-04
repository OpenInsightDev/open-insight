import * as Bench from "#/bench/index.ts";
import { Harness } from "@open-insight/core/internal";
import { Data, Schema } from "effect";

export class Metadata extends Schema.Class<Metadata>("EvalMetadata")({
  id: Schema.String,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export const RunOptions = Schema.Struct({
  trailCount: Schema.Number,
});
export type RunOptions = Schema.Schema.Type<typeof RunOptions>;

export class Eval<
  ID extends string,
  B extends Bench.Any,
  H extends Harness.Any,
> extends Data.Class<{
  id: ID;

  bench: B;
  harness: H;
  metadata: Metadata;

  options: RunOptions;
}> {}
export type Any = Eval<any, any, any>;

export type IDOf<E> = E extends Eval<infer ID, any, any> ? ID : never;
export type BenchOf<E> = E extends Eval<any, infer B, any> ? B : never;
export type HarnessOf<E> = E extends Eval<any, any, infer H> ? H : never;

type Options<B extends Bench.Any, H extends Harness.Any> = Omit<MetadataEncoded, "id"> &
  RunOptions &
  Readonly<{
    bench: B;
    harness: H;
  }>;

export const make = <ID extends string, B extends Bench.Any, H extends Harness.Any>(
  id: ID,
  options: Options<B, H>,
) => {
  const metadata = Schema.decodeSync(Metadata)({ id, ...options });
  const runOptions = Schema.decodeSync(RunOptions)(options);
  const { bench, harness } = options;

  return new Eval({ id, bench, harness, metadata, options: runOptions });
};
