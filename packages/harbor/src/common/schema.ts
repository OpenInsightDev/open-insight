import { Effect, pipe, Schema } from "effect";

/**
 * Wraps a schema's nullable/default-value handling so a constructor default is
 * applied both at construction time and during decoding.
 *
 * Defined once here and shared across all module families (common, dataset,
 * job, package, task, trajectory, trial) to avoid duplicated definitions.
 */
export const withDefault = <S extends Schema.Constraint & Schema.WithoutConstructorDefault>(
  schema: S,
  value: () => Schema.Schema.Type<S>,
) =>
  pipe(
    schema,
    Schema.withConstructorDefault(Effect.sync(value)),
    Schema.withDecodingDefaultTypeKey(Effect.sync(value)),
  );
