import { Schema } from "effect";
import type { Grader } from "../index.ts";

class Exists extends Schema.Class<Exists>("FileExistsGrade")({
  exists: Schema.Boolean,
}) {}

export const exists = (sandboxPath: string) =>
  ({
    schema: Exists,
    grade: async ({ $ }) => {
      try {
        await $`test -e ${sandboxPath}`;
        return { exists: true };
      } catch {
        return { exists: false };
      }
    },
  }) satisfies Grader<Exists>;
