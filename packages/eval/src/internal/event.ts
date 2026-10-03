import type * as Event from "#/Event.ts";
import type { Trajectory } from "@open-insight/core";
import { Match, Result } from "effect";

export const sessionPart = (
  event: Event.SessionSuccessEvent,
): Result.Result<Trajectory.AllSessionPart<{}>, void> =>
  Match.value(event).pipe(
    Match.tag("SessionPromptEvent", ({ prompt }) => Result.succeed(prompt)),
    Match.tag("SessionStreamEvent", ({ part }) => Result.succeed(part)),
    Match.orElse(() => Result.failVoid),
  );
