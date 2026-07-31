import { Schema } from "effect";
import { make, type Verif } from "../index.ts";

export const exists = (sandboxPath: string, options?: Verif) =>
  make(Schema.Struct({ exists: Schema.Boolean }))(async ({ $ }) => {
    try {
      await $`test -e ${sandboxPath}`;
      return { exists: true };
    } catch {
      return { exists: false };
    }
  }, options);
