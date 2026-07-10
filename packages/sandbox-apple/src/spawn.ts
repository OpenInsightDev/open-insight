import { Sandbox } from "@open-insight/core/internal";
import { Spawn } from "@open-insight/core/utils";
import { Effect, Layer } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { containerOptions } from "./utils.ts";

export const makeSandboxSpawner = Effect.fn(function* (
  sandboxName: string,
): Effect.fn.Return<Layer.Layer<Sandbox.Spawn.Service>, never, Spawn.Service> {
  const spawner = yield* Spawn.Service;

  const fn: Sandbox.Spawn.Fn = Effect.fn(function* ({ command, args, cwd, env }, options) {
    const execArgs: string[] = [];
    for (const [key, value] of Object.entries(env ?? {})) {
      if (value !== undefined) {
        execArgs.push("--env", `${key}=${value}`);
      }
    }

    if (cwd !== undefined) {
      execArgs.push("--workdir", cwd);
    }

    execArgs.push(sandboxName, command);
    execArgs.push(...(args ?? []));

    return yield* spawner.exec(
      CP.make("container", ["exec", ...execArgs], containerOptions),
      options,
    );
  });

  return Sandbox.Spawn.Service.layerFrom(fn);
});
