export const passAtK =
  (k: number) =>
  (passes: boolean[]): number => {
    const top = passes.slice(0, k);
    return top.length === 0 ? 0 : top.some((p) => p) ? 1 : 0;
  };

export const passPowerK =
  (k: number) =>
  (passes: boolean[]): number => {
    const top = passes.slice(0, k);
    return top.length === 0 ? 0 : top.filter((p) => p).length / top.length;
  };
