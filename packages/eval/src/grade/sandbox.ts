import { Sandbox, type Prompt, type Snapshot } from "@open-insight/core/internal";
import type { BivariantFn } from "#/utils/variant.ts";
import type { AnyResult } from "./base.ts";
import type { Verif } from "./verif.ts";
import { Effect, FiberSet, FileSystem, Path } from "effect";

export type SandboxScope = "per-task" | "per-trail";

type TransferOptions = Readonly<{
  /** Path in the agent sandbox to copy. Files and directories are supported. */
  agentPath: string;
  /** Destination in the grade sandbox. Defaults to `agentPath`. */
  gradePath?: string;
}>;

type SandboxContext = Sandbox.SandboxPromise &
  Readonly<{
    /** The sandbox in which the agent performed the task. */
    agent: Sandbox.SandboxPromise;

    /** Trasfer a file or directory from the agent sandbox to the grade sandbox. */
    transfer(options: TransferOptions): Promise<void>;
  }>;

const makeTransfer = ({ agent, grade }: { agent: Sandbox.Sandbox; grade: Sandbox.Sandbox }) =>
  Effect.fn(
    function* ({ agentPath, gradePath = agentPath }: TransferOptions) {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const archiveName = "transfer.tar.gz";
      const agentTmp = yield* agent
        .stdout({ command: "mktemp", args: ["-d"] })
        .pipe(Effect.map((output) => output.trim()));
      const gradeTmp = yield* grade
        .stdout({ command: "mktemp", args: ["-d"] })
        .pipe(Effect.map((output) => output.trim()));
      const hostArchive = yield* fs.makeTempFileScoped({ prefix: "open-insight-grade-transfer-" });

      const agentArchive = `${agentTmp}/${archiveName}`;
      const gradeArchive = `${gradeTmp}/${archiveName}`;
      const stageDir = `${gradeTmp}/stage`;

      const core = agent
        .success({
          command: "tar",
          args: ["-czf", agentArchive, "-C", path.dirname(agentPath), path.basename(agentPath)],
        })
        .pipe(
          Effect.andThen(agent.download({ sandboxPath: agentArchive, hostPath: hostArchive })),
          Effect.andThen(grade.upload({ sandboxPath: gradeArchive, hostPath: hostArchive })),
          Effect.andThen(grade.success({ command: "mkdir", args: ["-p", stageDir] })),
          Effect.andThen(
            grade.success({ command: "tar", args: ["-xzf", gradeArchive, "-C", stageDir] }),
          ),
          Effect.andThen(
            grade.success({ command: "mkdir", args: ["-p", path.dirname(gradePath)] }),
          ),
          Effect.andThen(
            grade.success({
              command: "mv",
              args: [`${stageDir}/${path.basename(agentPath)}`, gradePath],
            }),
          ),
        );

      const cleanup = Effect.all([
        fs.remove(hostArchive, { force: true }),
        agent.success({ command: "rm", args: ["-rf", agentTmp] }),
        grade.success({ command: "rm", args: ["-rf", gradeTmp] }),
      ]).pipe(Effect.ignore);

      return yield* core.pipe(Effect.ensuring(cleanup));
    },
    (effect) => effect.pipe(Effect.scoped),
  );

export const makeSandboxContext = Effect.fn(function* ({
  agent,
  grade,
}: {
  agent: Sandbox.Sandbox;
  grade: Sandbox.Sandbox;
}) {
  const runPromise = yield* FiberSet.makeRuntimePromise();
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const agentSandbox = yield* Sandbox.asPromise(agent);
  const gradeSandbox = yield* Sandbox.asPromise(grade);

  const transfer = makeTransfer({ agent, grade });
  const transferPromise = (options: TransferOptions) =>
    runPromise(
      transfer(options).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      ),
    );

  return {
    ...gradeSandbox,
    agent: agentSandbox,
    transfer: transferPromise,
  };
});

export type Context = SandboxContext &
  Readonly<{
    trajectory: Prompt.Trajectory;
  }>;

export type Exec<R extends AnyResult = AnyResult> = BivariantFn<
  (ctx: Context) => PromiseLike<R["Encoded"]>
>;

type Config = Readonly<{
  scope: SandboxScope;
}>;

export type Grader<R extends AnyResult = AnyResult> = Readonly<{
  schema: R;
  grade: Exec<R>;
  snapshot: Snapshot.Template;
  verif: Verif<R> | null;
  config: Config;
}>;

type Options<R extends AnyResult> = Readonly<{
  scope?: SandboxScope;
  verif?: Verif<R> | null;
}> &
  Partial<Config>;

export const make =
  <R extends AnyResult>(schema: R) =>
  (
    grade: Exec<R>,
    snapshot: Snapshot.Template,
    { verif = null, scope = "per-trail" }: Options<R> = {},
  ): Grader<R> => ({
    schema,
    grade,
    snapshot,
    verif,
    config: {
      scope,
    },
  });
