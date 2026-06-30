import type { Exec } from "../index.ts";

export const bash =
  (bash: string): Exec<string> =>
  async (ctx) => {
    return await ctx.$({ command: "bash", args: ["-lc", bash] });
  };
