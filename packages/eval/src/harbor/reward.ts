import { Schema } from "effect";
import type * as Grade from "#/grade/index.ts";
import type { MultiStepRewardStrategy } from "./config.ts";

export const GradeResult = Schema.Record(Schema.String, Schema.Finite);
export type GradeResult = Schema.Schema.Type<typeof GradeResult>;

export const mean = (results: ReadonlyArray<GradeResult>): GradeResult => {
  const keys = new Set(results.flatMap((result) => Object.keys(result)));
  const aggregated: Record<string, number> = {};
  for (const key of keys) {
    aggregated[key] = results.reduce((sum, result) => sum + (result[key] ?? 0), 0) / results.length;
  }
  return aggregated;
};

export const wrapGrader = (
  grader: Grade.BaseGrader<GradeResult, Grade.Results>,
  strategy: MultiStepRewardStrategy,
  finalStage: boolean,
): Grade.BaseGrader<GradeResult, Grade.Results> => {
  if (!finalStage || strategy === "final") {
    return grader;
  }
  return async (context) => {
    const current = await grader(context);
    const previous = await Promise.all(
      Object.values(context.prevResults).map((result) =>
        Schema.decodeUnknownPromise(GradeResult)(result),
      ),
    );
    return mean([...previous, current]);
  };
};
