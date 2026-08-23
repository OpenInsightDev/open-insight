export const hasProperty = <Field extends PropertyKey>(
  field: Field,
  value: unknown,
): value is Record<Field, unknown> => {
  return typeof value === "object" && value !== null && field in value;
};
