import { Tasks } from "#/export.ts";
import { Effect } from "effect";

const main = Effect.gen(function* () {
  const tasks = yield* Tasks.Harbor.fromDir();
});
