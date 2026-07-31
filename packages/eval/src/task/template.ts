import { Schema, Struct } from "effect";
import { EmptyRecord, IDSchema } from "#/utils/schema.ts";

export const ID = Schema.String;
export type ID = Schema.Schema.Type<typeof ID>;

export class StageMetadata extends Schema.Class<StageMetadata>("StageMetadata")({
  id: IDSchema,
  name: Schema.String,
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}

export class BaseMetadata extends Schema.Class<BaseMetadata>("BaseMetadata")({
  id: Schema.String,
  name: Schema.String,
  description: Schema.OptionFromOptionalNullOr(Schema.String),
  keywords: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
  authors: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.String)),
}) {}

type Template<
  S extends Record<PropertyKey, Schema.Constraint> = Record<string, Schema.Constraint>,
  E extends Schema.Constraint = EmptyRecord,
> = Readonly<{
  stages: S;
  extras: E;
}>;

export const make = <S extends Record<PropertyKey, Schema.Constraint>, E extends Schema.Constraint>(
  stages: S,
  extras: E,
): Template<S, E> => ({ stages, extras });

interface makeTrail<S extends Schema.Constraint> extends Schema.Struct<{
  metadata: typeof StageMetadata;
  result: S;
}> {}
interface TrailFieldLambda extends Struct.Lambda {
  <S extends Schema.Constraint>(schema: S): makeTrail<S>;
  readonly "~lambda.out": this["~lambda.in"] extends Schema.Constraint
    ? makeTrail<this["~lambda.in"]>
    : never;
}
const makeTrail = Struct.lambda<TrailFieldLambda>((result) =>
  Schema.Struct({ metadata: StageMetadata, result }),
);

export const makeResultTemplate = <
  S extends Record<PropertyKey, Schema.Constraint>,
  E extends Schema.Constraint,
>(
  template: Template<S, E>,
) =>
  Schema.Struct({
    metadata: BaseMetadata,
    extras: template.extras,
    trails: Schema.Array(Schema.Struct(Struct.map(template.stages, makeTrail))),
  });
