import { Schema } from "effect";
import { make } from "../index.ts";

class Success extends Schema.Class<Success>("CommandSuccessGrade")({
  success: Schema.Boolean,
}) {}

export const success = (bash: string) =>
  make(Success, async ({ $ }) =>
    $`${bash}`.then(() => ({ success: true })).catch(() => ({ success: false })),
  );
