import { Sandbox } from "@open-insight/core";
import { Effect } from "effect";
import { Toolkit } from "effect/unstable/ai";
import { formatError } from "./error.ts";
import { Execute } from "./execute.ts";
import { ReadFile, WriteFile } from "./file.ts";

export const toolkit = Toolkit.make(Execute, ReadFile, WriteFile);
export type Tools = Toolkit.Tools<typeof toolkit>;

export const layer = toolkit.toLayer({
  Execute: Effect.fn(function* ({ command, args, cwd, env }) {
    const sandbox = yield* Sandbox.Current;
    return yield* sandbox
      .spawn(
        {
          command,
          args: args === undefined ? undefined : Array.from(args),
          cwd,
          env: env === undefined ? undefined : { ...env },
        },
        { errorOnNonZeroExit: false },
      )
      .pipe(
        Effect.map(({ exitCode, stdout, stderr }) => ({ exitCode, stdout, stderr })),
        Effect.mapError(formatError),
      );
  }),
  ReadFile: Effect.fn(function* ({ path }) {
    const sandbox = yield* Sandbox.Current;
    return yield* sandbox.readFile({ sandboxPath: path }).pipe(Effect.mapError(formatError));
  }),
  WriteFile: Effect.fn(function* ({ path, content }) {
    const sandbox = yield* Sandbox.Current;
    return yield* sandbox
      .writeFile({ sandboxPath: path, content })
      .pipe(Effect.as({ path }), Effect.mapError(formatError));
  }),
});
