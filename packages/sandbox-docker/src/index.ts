import { Effect } from "effect";

export const makeNetwork = Effect.fn(function* () {});

export const makeProcess = Effect.fn(function* (containerID: string) {});

export const makeTerminal = Effect.fn(function* (containerID: string) {});

export const make = Effect.fn(function* () {});
