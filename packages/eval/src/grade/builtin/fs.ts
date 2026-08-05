import { Schema } from "effect";
import { make, type Verif } from "../index.ts";

const Result = Schema.Struct({ exists: Schema.Boolean });

export const exists = (sandboxPath: string, options?: Verif<typeof Result>) =>
  make(Result)(async ({ $ }) => {
    try {
      await $`test -e ${sandboxPath}`;
      return { exists: true };
    } catch {
      return { exists: false };
    }
  }, options);
