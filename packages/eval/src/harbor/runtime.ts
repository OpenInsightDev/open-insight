import { Sandbox } from "@open-insight/core/internal";
import type * as Grade from "#/grade/index.ts";
import type * as Task from "#/task/index.ts";
import type { HealthcheckConfig } from "./config.ts";
import { GradeResult as Result, type GradeResult } from "./reward.ts";
import { Schema } from "effect";

const rewardTxt = "/logs/verifier/reward.txt";
const rewardJson = "/logs/verifier/reward.json";

const decodeJson = async (content: string): Promise<GradeResult> => {
  const parsed: unknown = JSON.parse(content);
  return Schema.decodeUnknownPromise(Result)(parsed);
};

const decodeText = async (content: string): Promise<GradeResult> => {
  const value = content.trim();
  if (value.length === 0) {
    throw new Error(`Harbor reward file is empty: ${rewardTxt}`);
  }
  return Schema.decodeUnknownPromise(Result)({ reward: Number(value) });
};

const uploadDir = async ({
  sandbox,
  dir,
  target,
  temp,
}: {
  readonly sandbox: Sandbox.SandboxPromise;
  readonly dir: string;
  readonly target: string;
  readonly temp: string;
}) => {
  await sandbox.$`rm -rf ${temp}`;
  await sandbox.upload({ hostPath: dir, sandboxPath: temp });
  await sandbox.$`mkdir -p ${target} && cp -a ${`${temp}/.`} ${`${target}/`}`;
  await sandbox.$`rm -rf ${temp}`;
};

const uploadDirs = async ({
  sandbox,
  dirs,
  target,
  temp,
}: {
  readonly sandbox: Sandbox.SandboxPromise;
  readonly dirs: ReadonlyArray<string>;
  readonly target: string;
  readonly temp: string;
}) => {
  await sandbox.$`rm -rf ${target} && mkdir -p ${target}`;
  for (const [index, dir] of dirs.entries()) {
    await uploadDir({
      sandbox,
      dir,
      target,
      temp: `${temp}-${index}`,
    });
  }
};

export const makeGrader =
  ({
    testDirs,
    workdir,
    env = {},
  }: {
    readonly testDirs: ReadonlyArray<string>;
    readonly workdir?: string;
    readonly env?: Readonly<Record<string, string>>;
  }): Grade.BaseGrader<GradeResult, Grade.Results> =>
  async (sandbox) => {
    await sandbox.$`rm -rf /logs/verifier && mkdir -p /logs/verifier`;
    await uploadDirs({
      sandbox,
      dirs: testDirs,
      target: "/tests",
      temp: "/tmp/open-insight-harbor-tests",
    });
    await sandbox.$({ cwd: workdir, env })`bash /tests/test.sh`;

    const rewardFormat = (
      await sandbox.$`if [ -f ${rewardJson} ]; then printf json; elif [ -f ${rewardTxt} ]; then printf text; else exit 1; fi`
    ).trim();
    if (rewardFormat === "json") {
      return decodeJson(await sandbox.readFile({ sandboxPath: rewardJson }));
    }
    if (rewardFormat === "text") {
      return decodeText(await sandbox.readFile({ sandboxPath: rewardTxt }));
    }
    throw new Error(`Harbor verifier did not produce ${rewardJson} or ${rewardTxt}`);
  };

export const makeVerifier =
  ({
    solutionDir,
    workdir,
    env = {},
  }: {
    readonly solutionDir: string;
    readonly workdir?: string;
    readonly env?: Readonly<Record<string, string>>;
  }): Grade.VerifExec =>
  async (sandbox) => {
    await uploadDirs({
      sandbox,
      dirs: [solutionDir],
      target: "/solution",
      temp: "/tmp/open-insight-harbor-solution",
    });
    await sandbox.$({ cwd: workdir, env })`bash /solution/solve.sh`;
    return null;
  };

const healthcheck = async ({
  sandbox,
  config,
  workdir,
  label,
}: {
  readonly sandbox: Sandbox.SandboxPromise;
  readonly config: HealthcheckConfig;
  readonly workdir?: string;
  readonly label: string;
}) => {
  const retries = Math.max(1, Math.floor(config.retries ?? 3));
  const intervalSec = Math.max(0, config.interval_sec ?? 5);
  const timeoutSec = Math.max(0.001, config.timeout_sec ?? 30);
  const startPeriodSec = Math.max(0, config.start_period_sec ?? 0);

  if (startPeriodSec > 0) {
    await sandbox.$`sleep ${startPeriodSec}`;
  }

  let lastExitCode = -1;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const result = await sandbox.cmd({
      command: "timeout",
      args: [`${timeoutSec}s`, "bash", "-lc", config.command],
      cwd: workdir,
    });
    lastExitCode = result.exitCode;
    if (lastExitCode === 0) {
      return;
    }
    if (attempt < retries) {
      await sandbox.$`sleep ${intervalSec}`;
    }
  }
  throw new Error(`${label} failed after ${retries} attempts (exit code ${lastExitCode})`);
};

export const makeInit = ({
  workdir,
  workdirDir,
  setup,
  environmentHealthcheck,
  stepHealthcheck,
}: {
  readonly workdir?: string;
  readonly workdirDir?: string;
  readonly setup: boolean;
  readonly environmentHealthcheck?: HealthcheckConfig;
  readonly stepHealthcheck?: HealthcheckConfig;
}): Task.Init | null => {
  if (
    workdirDir === undefined &&
    environmentHealthcheck === undefined &&
    stepHealthcheck === undefined
  ) {
    return null;
  }

  return async (sandbox) => {
    const current = (await sandbox.$`pwd`).trim();
    const cwd = workdir ?? (current.length === 0 ? "/" : current);
    if (environmentHealthcheck !== undefined) {
      await healthcheck({
        sandbox,
        config: environmentHealthcheck,
        workdir: cwd,
        label: "Harbor environment healthcheck",
      });
    }
    if (workdirDir !== undefined) {
      await uploadDir({
        sandbox,
        dir: workdirDir,
        target: cwd,
        temp: "/tmp/open-insight-harbor-workdir",
      });
      if (setup) {
        const setupPath = `${cwd.replace(/\/$/, "")}/setup.sh`;
        await sandbox.$({ cwd })`bash ${setupPath}`;
      }
    }
    if (stepHealthcheck !== undefined) {
      await healthcheck({
        sandbox,
        config: stepHealthcheck,
        workdir: cwd,
        label: "Harbor step healthcheck",
      });
    }
  };
};
