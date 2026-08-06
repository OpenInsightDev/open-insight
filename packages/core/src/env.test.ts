import { assert, it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit } from "effect";
import { OPENINSIGHT_LOG_LEVEL, OPENINSIGHT_LOG_LEVEL_DEFAULT, resolveLogLevel } from "./env.ts";

const fromEnv = (env: Record<string, string>) =>
  ConfigProvider.fromEnv({
    env: { ...env },
  });

const resolveWith = (env: Record<string, string>) =>
  resolveLogLevel().pipe(Effect.provideService(ConfigProvider.ConfigProvider, fromEnv(env)));

it.effect("resolves an explicit log level from the environment", () =>
  Effect.gen(function* () {
    const level = yield* resolveWith({ [OPENINSIGHT_LOG_LEVEL]: "Debug" });
    assert.strictEqual(level, "Debug");
  }),
);

it.effect("falls back to the default level when the variable is unset", () =>
  Effect.gen(function* () {
    const level = yield* resolveWith({});
    assert.strictEqual(level, OPENINSIGHT_LOG_LEVEL_DEFAULT);
  }),
);

it.effect("rejects an unsupported log level value", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(resolveWith({ [OPENINSIGHT_LOG_LEVEL]: "Verbose" }));
    assert.isTrue(Exit.isFailure(exit));
  }),
);
