import { Schema } from "effect";
import { make, type Verif } from "../index.ts";

export const success = (bash: string, options?: Verif) =>
  make(Schema.Struct({ success: Schema.Boolean }))(
    async ({ $ }) => $`${bash}`.then(() => ({ success: true })).catch(() => ({ success: false })),
    options,
  );
