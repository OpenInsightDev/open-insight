/** Returns `1` when any of the first `k` attempts passed, otherwise `0`. */
export const passAtK =
  (k: number) =>
  (passes: ReadonlyArray<boolean>): number => {
    const top = passes.slice(0, k);
    return top.length === 0 ? 0 : top.some((p) => p) ? 1 : 0;
  };

/** Returns the pass ratio among the first `k` attempts, or `0` when no attempts exist. */
export const passPowerK =
  (k: number) =>
  (passes: ReadonlyArray<boolean>): number => {
    const top = passes.slice(0, k);
    return top.length === 0 ? 0 : top.filter((p) => p).length / top.length;
  };
