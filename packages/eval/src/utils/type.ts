export function assertNonNull<T>(val: T): asserts val is NonNullable<T> {
  if (val === null || val === undefined) {
    throw new Error("Value cannot be null or undefined");
  }
}
