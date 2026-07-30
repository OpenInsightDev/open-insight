import { Schema } from "effect";
import type { Grader } from "../index.ts";

class Success extends Schema.Class<Success>("CommandSuccessGrade")({
  success: Schema.Boolean,
}) {}

export const success = (bash: string) =>
  ({
    schema: Success,
    grade: async ({ $ }) =>
      $`${bash}`.then(() => ({ success: true })).catch(() => ({ success: false })),
  }) satisfies Grader<Success>;
