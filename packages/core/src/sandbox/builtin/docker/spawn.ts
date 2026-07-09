import { Effect, Layer } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import * as Sandbox from "#/sandbox/export.ts";
import * as Runtime from "./runtime.ts";
import { Spawn } from "#/utils/export.ts";

export const makeSandboxSpawner = Effect.fn(function* (
  sandboxName: string,
): Effect.fn.Return<Layer.Layer<Sandbox.Spawn.Service>, never, Spawn.Service> {
  const runtime = yield* Runtime.Runtime;
  const spawner = yield* Spawn.Service;

  const fn: Sandbox.Spawn.Fn = Effect.fn(function* ({ command, args, cwd, env }) {
    const execArgs: string[] = [sandboxName];

    execArgs.push("-it");

    for (const [key, value] of Object.entries(env ?? {})) {
      if (value !== undefined) {
        execArgs.push("-e", `${key}=${value}`);
      }
    }

    if (cwd !== undefined) {
      execArgs.push("--workdir", cwd);
    }

    execArgs.push(command);
    execArgs.push(...(args ?? []));

    return yield* spawner.exec(CP.make("exec", execArgs).pipe(runtime), {
      errorOnNonZeroExit: true,
    });
  });

  return Sandbox.Spawn.Service.layerFrom(fn);
});
