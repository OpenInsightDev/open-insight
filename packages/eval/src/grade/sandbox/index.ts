import { Sandbox as CoreSandbox, Snapshot } from "@open-insight/core/internal";
import { Effect, FileSystem, FiberSet, Path } from "effect";
import type { BivariantFn } from "#/utils/variant.ts";
import { Error, Retry } from "../error.ts";
import type { Context as BaseContext, Result, Results } from "../index.ts";

export type TypeId = "~open-insight/eval/grade/sandbox";
export const TypeId: TypeId = "~open-insight/eval/grade/sandbox";

export type CopyFromAgentOptions = Readonly<{
  /** Path in the agent sandbox to copy. Files and directories are supported. */
  agentPath: string;
  /** Destination in the grade sandbox. Defaults to `agentPath`. */
  gradePath?: string;
}>;

export type CopyToAgentOptions = Readonly<{
  /** Path in the grade sandbox to copy. Files and directories are supported. */
  gradePath: string;
  /** Destination in the agent sandbox. Defaults to `gradePath`. */
  agentPath?: string;
}>;

export type Context<Rs extends Results = never> = Readonly<{
  /** The sandbox in which the agent performed the task. */
  agent: CoreSandbox.SandboxPromise;
  /** A fresh, isolated sandbox created for this grader execution. */
  grade: CoreSandbox.SandboxPromise;
  /** Copy a file or directory from the agent sandbox into the grade sandbox. */
  copyFromAgent(options: CopyFromAgentOptions): Promise<void>;
  /** Copy a file or directory from the grade sandbox back into the agent sandbox. */
  copyToAgent(options: CopyToAgentOptions): Promise<void>;
  results: Rs;
  trajectory: BaseContext<Rs>["trajectory"];
}>;

export type GradeFn<R extends Result = Result, Rs extends Results = never> = BivariantFn<
  (context: Context<Rs>) => PromiseLike<R>
>;

export type Grader<R extends Result = Result, Rs extends Results = never> = Readonly<{
  [TypeId]: TypeId;
  snapshot: Snapshot.Snapshot;
  resources: CoreSandbox.Resources;
  cacheSnapshot: boolean;
  grade: GradeFn<R, Rs>;
}>;

export type Options<R extends Result = Result, Rs extends Results = never> = Readonly<{
  snapshot: Snapshot.Snapshot;
  resources?: CoreSandbox.Resources;
  /** Cache the prepared grade image while still starting a fresh sandbox per execution. */
  cacheSnapshot?: boolean;
  grade: GradeFn<R, Rs>;
}>;

/**
 * Creates a grader that executes in a fresh sandbox isolated from the agent sandbox.
 *
 * The snapshot may be cached, but the running grade sandbox is created for every
 * grader execution and is released as soon as that execution completes.
 *
 * @example
 * ```ts
 * const grader = Grade.Sandbox.make({
 *   snapshot: Snapshot.make({ image: "python:3.13-slim" }),
 *   grade: async ({ grade, copyFromAgent }) => {
 *     await copyFromAgent({
 *       agentPath: "/workspace/answer.py",
 *       gradePath: "/submission/answer.py",
 *     });
 *     const output = await grade.$`python /tests/grade.py /submission/answer.py`;
 *     return { passed: output.trim() === "pass" };
 *   },
 * });
 * ```
 */
export const make = <R extends Result = Result, Rs extends Results = never>({
  snapshot,
  resources = new CoreSandbox.Resources(),
  cacheSnapshot = true,
  grade,
}: Options<R, Rs>): Grader<R, Rs> => ({
  [TypeId]: TypeId,
  snapshot,
  resources,
  cacheSnapshot,
  grade,
});

export const is = (value: unknown): value is Grader =>
  typeof value === "object" && value !== null && TypeId in value && value[TypeId] === TypeId;

const makeCopy = Effect.fn(function* (
  source: CoreSandbox.SandboxPromise,
  destination: CoreSandbox.SandboxPromise,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runPromise = yield* FiberSet.makeRuntimePromise();

  return (sourcePath: string, destinationPath: string): Promise<void> =>
    runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tempDirectory = yield* fs.makeTempDirectoryScoped({
            prefix: "open-insight-grade-transfer-",
          });
          const hostPath = path.join(tempDirectory, "payload");
          yield* Effect.promise(() => source.download({ sandboxPath: sourcePath, hostPath }));
          yield* Effect.promise(() =>
            destination.upload({ sandboxPath: destinationPath, hostPath }),
          );
        }),
      ),
    );
});

export type Services = CoreSandbox.ProviderService | FileSystem.FileSystem | Path.Path;

export const run = <R extends Result, Rs extends Results>(
  grader: Grader<R, Rs>,
  context: BaseContext<Rs>,
): Effect.Effect<R, Error | Retry, Services> =>
  Effect.scoped(
    Effect.gen(function* () {
      const provider = yield* CoreSandbox.ProviderService;
      const handle = yield* provider
        .aquireSnapshot({ snapshot: grader.snapshot, cache: grader.cacheSnapshot })
        .pipe(Effect.mapError(Error.exec));
      const sandbox = yield* provider
        .runSandbox({ handle, resources: grader.resources })
        .pipe(Effect.mapError(Error.exec));
      const gradeSandbox = yield* CoreSandbox.asPromise(sandbox);
      const copyFromAgentPath = yield* makeCopy(context, gradeSandbox);
      const copyToAgentPath = yield* makeCopy(gradeSandbox, context);

      return yield* Effect.tryPromise({
        try: () =>
          grader.grade({
            agent: context,
            grade: gradeSandbox,
            copyFromAgent: ({ agentPath, gradePath = agentPath }) =>
              copyFromAgentPath(agentPath, gradePath),
            copyToAgent: ({ gradePath, agentPath = gradePath }) =>
              copyToAgentPath(gradePath, agentPath),
            results: context.results,
            trajectory: context.trajectory,
          }),
        catch: (cause) => (cause instanceof Retry ? cause : Error.exec(cause)),
      });
    }),
  );
