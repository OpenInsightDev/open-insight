import { Resource, Sandbox, Snapshot } from "@open-insight/core/internal";

import { Effect, FileSystem, flow, Path, Schema } from "effect";
import * as Retry from "./retry.ts";
import { GradeError } from "./error.ts";

export type SandboxScope = "per-task" | "per-trail";

export type TransferOptions = Readonly<{
  /** Path in the agent sandbox to copy. Files and directories are supported. */
  agentPath: string;
  /** Destination in the grade sandbox. Defaults to `agentPath`. */
  gradePath?: string;
}>;

export type Context = Sandbox.Sandbox &
  Readonly<{
    /** The sandbox in which the agent performed the task. */
    agent: Sandbox.Sandbox;

    /** Trasfer a file or directory from the agent sandbox to the grade sandbox. */
    transfer(options: TransferOptions): Effect.Effect<void, GradeError>;
  }>;

const makeTransfer = Effect.fn(function* ({
  agent,
  grade,
}: {
  agent: Sandbox.Sandbox;
  grade: Sandbox.Sandbox;
}) {
  const ctx = yield* Effect.context<FileSystem.FileSystem | Path.Path>();

  return Effect.fn(
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

      yield* Effect.addFinalizer(() =>
        Effect.all([
          fs.remove(hostArchive, { force: true }),
          agent.success({ command: "rm", args: ["-rf", agentTmp] }),
          grade.success({ command: "rm", args: ["-rf", gradeTmp] }),
        ]).pipe(Effect.ignore),
      );

      yield* agent.success({
        command: "tar",
        args: ["-czf", agentArchive, "-C", path.dirname(agentPath), path.basename(agentPath)],
      });
      yield* agent.download({ sandboxPath: agentArchive, hostPath: hostArchive });
      yield* grade.upload({ sandboxPath: gradeArchive, hostPath: hostArchive });
      yield* grade.success({ command: "mkdir", args: ["-p", stageDir] });
      yield* grade.success({ command: "tar", args: ["-xzf", gradeArchive, "-C", stageDir] });
      yield* grade.success({ command: "mkdir", args: ["-p", path.dirname(gradePath)] });
      yield* grade.success({
        command: "mv",
        args: [`${stageDir}/${path.basename(agentPath)}`, gradePath],
      });
    },
    flow(Effect.mapError(GradeError.exec), Effect.provide(ctx), Effect.scoped),
  );
});

type MakeContextOptions = Readonly<{
  agent: Sandbox.Sandbox;
  grade: Sandbox.Sandbox;
}>;

export const makeContext = Effect.fn(function* ({ agent, grade }: MakeContextOptions) {
  const transfer = yield* makeTransfer({ agent, grade });

  return {
    ...grade,
    agent,
    transfer,
  } satisfies Context;
});

export type Exec<Result extends Schema.Constraint = any> = (
  ctx: Context,
) => Effect.Effect<Result["Type"], unknown>;

export type Grader<Result extends Schema.Constraint = any> = ((
  ctx: Context,
) => Effect.Effect<Result["Type"], GradeError | Retry.Retry>) &
  Readonly<{
    snapshot: Snapshot.Template;
    resources: Resource.Resources;
    scope: SandboxScope;
    concurrency: number;
  }>;

export type Options<Result extends Schema.Constraint = any> = Readonly<{
  grade: Exec<Result>;
  snapshot?: Snapshot.Template;
  resources?: Resource.Resources;
  scope?: SandboxScope;
  concurrency?: number;
}>;
export const make = <Result extends Schema.Constraint>({
  grade: gradeOption,
  snapshot = Snapshot.Alpine,
  resources = Resource.providerDefault,
  scope = "per-trail",
  concurrency = 1,
}: Options<Result>) => {
  const exec = (context: Context) => gradeOption(context).pipe(Effect.mapError(GradeError.exec));

  return Object.assign(exec, {
    snapshot,
    resources,
    scope,
    concurrency,
  }) satisfies Grader<Result>;
};
