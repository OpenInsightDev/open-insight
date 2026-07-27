import { Effect } from "effect";
import { Bench } from "#/export.ts";

const makeBench = async () => {
  return Effect.gen(function* () {
    return yield* Bench.make({
      id: "workbuddy-bench",
      tasks: [],
    });
  });
};
