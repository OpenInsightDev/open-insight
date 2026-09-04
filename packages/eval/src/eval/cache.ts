import type { TrailID } from "#/event/index.ts";
import { Effect } from "effect";

export const ensureTrailDir = Effect.fn(function* (trailID: TrailID) {});
