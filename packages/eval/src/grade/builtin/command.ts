import { Schema } from "effect";
import { make } from "../index.ts";
import type { Verif } from "../verif.ts";

export class Result extends Schema.Class<Result>("Grade.Command.Result")({
  success: Schema.Boolean,
}) {}

export const success = (bash: string, options?: Verif<typeof Result>) =>
  make(Result)(
    async ({ $ }) => $`${bash}`.then(() => ({ success: true })).catch(() => ({ success: false })),
    options,
  );
