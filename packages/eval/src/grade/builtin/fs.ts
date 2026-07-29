import { Schema } from "effect";
import { make } from "../index.ts";

class Exists extends Schema.Class<Exists>("FileExistsGrade")({
  exists: Schema.Boolean,
}) {}

export const exists = (sandboxPath: string) =>
  make(Exists, async ({ $ }) => {
    try {
      await $`test -e ${sandboxPath}`;
      return { exists: true };
    } catch {
      return { exists: false };
    }
  });
