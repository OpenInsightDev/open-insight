import type { Grader } from "../index.ts";

export const exists =
  (sandboxPath: string): Grader<{ exists: boolean }> =>
  async ({ $ }) => {
    try {
      await $`test -e ${sandboxPath}`;
      return { exists: true };
    } catch {
      return { exists: false };
    }
  };
