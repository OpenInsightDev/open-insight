export function assertNonNull<T>(val: T): asserts val is NonNullable<T> {
  if (val === null || val === undefined) {
    throw new Error("Value cannot be null or undefined");
  }
}

export type Exact<A, B> = A extends B ? (B extends A ? A : never) : never;

/**
 * Override properties of the T with properties from the U.
 *
 * Useful when original type already has a variant of the U but needs to be overridden with other variants.
 */
export type Override<T, U> = Omit<T, keyof U> & U;
