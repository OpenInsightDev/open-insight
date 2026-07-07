export function assertNonNull<T>(val: T): asserts val is NonNullable<T> {
  if (val === null || val === undefined) {
    throw new Error("Value cannot be null or undefined");
  }
}

export type EmptyRecord = Record<string, never>;

export type Exact<A, B> = A extends B ? (B extends A ? A : never) : never;
