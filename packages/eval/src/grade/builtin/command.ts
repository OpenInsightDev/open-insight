import type { Grader } from "../index.ts";

export const success =
  (bash: string): Grader<{ success: boolean }> =>
  async ({ $ }) =>
    $`${bash}`.then(() => ({ success: true })).catch(() => ({ success: false }));
