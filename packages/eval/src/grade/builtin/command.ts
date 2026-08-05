import { Schema } from "effect";
import { make, type Verif } from "../index.ts";

const Result = Schema.Struct({ success: Schema.Boolean });

export const success = (bash: string, options?: Verif<typeof Result>) =>
  make(Result)(
    async ({ $ }) => $`${bash}`.then(() => ({ success: true })).catch(() => ({ success: false })),
    options,
  );
