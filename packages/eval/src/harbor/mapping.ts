import { Resource, Snapshot } from "@open-insight/core/internal";
import { Effect, FileSystem, Path } from "effect";
import { Error as TasksError } from "#/tasks/error.ts";
import type {
  AgentConfig,
  EnvConfig,
  NetworkMode,
  StepConfig,
  TaskConfig,
  VerifierConfig,
  VerifierEnvironmentMode,
} from "./config.ts";

const unsupported = (message: string) => TasksError.unsupported(new Error(message));
const invalid = (message: string) => TasksError.invalid(new Error(message));

const envNetwork = (env: EnvConfig | undefined): NetworkMode => {
  if (env?.network_mode !== undefined) {
    return env.network_mode;
  }
  return env?.allow_internet === false ? "no-network" : "public";
};

const networkPolicy = (env: EnvConfig | undefined): Resource.Policy => {
  switch (envNetwork(env)) {
    case "no-network":
      return Resource.noNetwork();
    case "allowlist":
      return Resource.allowlist(env?.allowed_hosts ?? []);
    case "public":
      return Resource.publicAccess();
  }
};

const phaseConfig = (
  task: AgentConfig | VerifierConfig | undefined,
  step: AgentConfig | VerifierConfig | undefined,
) => (step?.network_mode === undefined ? task : step);

const verifierMode = (
  task: VerifierConfig | undefined,
  step: VerifierConfig | undefined,
): VerifierEnvironmentMode => {
  if (step?.environment_mode !== undefined) {
    return step.environment_mode;
  }
  if (step?.environment !== undefined) {
    return "separate";
  }
  if (task?.environment_mode !== undefined) {
    return task.environment_mode;
  }
  return task?.environment === undefined ? "shared" : "separate";
};

const sameUser = (left: string | number | undefined, right: string | number | undefined) =>
  left === undefined || right === undefined ? left === right : String(left) === String(right);

const agentUser = (config: TaskConfig): string | number | undefined => {
  const users = [
    config.agent?.user,
    ...(config.steps ?? []).map((step) => step.agent?.user),
  ].filter((user): user is string | number => user !== undefined);
  return users[0];
};

const validateNetwork = (
  label: string,
  config: AgentConfig | VerifierConfig | EnvConfig | undefined,
) => {
  if (config?.allowed_hosts !== undefined && config.network_mode !== "allowlist") {
    return invalid(`${label}.allowed_hosts requires network_mode = "allowlist"`);
  }
  return undefined;
};

export const validateConfig = Effect.fn("Task.Load.validateHarborConfig")(function* (
  config: TaskConfig,
) {
  const env = config.environment;
  if (env?.os === "windows") {
    return yield* Effect.fail(unsupported("Windows Harbor tasks are not supported"));
  }
  if (env?.tpu !== undefined) {
    return yield* Effect.fail(unsupported("Harbor TPU requirements are not supported"));
  }
  if ((env?.gpu_types?.length ?? 0) > 0) {
    return yield* Effect.fail(unsupported("Harbor GPU type constraints are not supported"));
  }
  if ((env?.mcp_servers?.length ?? 0) > 0) {
    return yield* Effect.fail(unsupported("Harbor environment MCP servers are not supported"));
  }
  if (env?.skills_dir !== undefined) {
    return yield* Effect.fail(unsupported("Harbor environment skills_dir is not supported"));
  }
  if ((config.artifacts?.length ?? 0) > 0) {
    return yield* Effect.fail(unsupported("Harbor artifact collection is not supported"));
  }
  if ((config.verifier?.collect?.length ?? 0) > 0) {
    return yield* Effect.fail(unsupported("Harbor verifier collect hooks are not supported"));
  }
  if (config.verifier?.environment_mode === "shared" && config.verifier.environment !== undefined) {
    return yield* Effect.fail(
      invalid('Harbor verifier.environment is incompatible with environment_mode = "shared"'),
    );
  }

  for (const issue of [
    validateNetwork("environment", env),
    validateNetwork("agent", config.agent),
    validateNetwork("verifier", config.verifier),
  ]) {
    if (issue !== undefined) {
      return yield* Effect.fail(issue);
    }
  }

  const baseMode = envNetwork(env);
  const baseHosts = env?.allowed_hosts ?? [];
  const agent = agentUser(config);
  const users = [config.agent?.user, ...(config.steps ?? []).map((step) => step.agent?.user)];
  if (users.some((user) => user !== undefined && !sameUser(user, agent))) {
    return yield* Effect.fail(
      unsupported("Different agent users across Harbor steps are not supported"),
    );
  }

  const steps: ReadonlyArray<StepConfig | undefined> =
    config.steps === undefined || config.steps.length === 0 ? [undefined] : config.steps;
  for (const step of steps) {
    const label = step === undefined ? "task" : `step ${JSON.stringify(step.name)}`;
    if (step?.min_reward !== undefined) {
      return yield* Effect.fail(
        unsupported(`Harbor ${label} min_reward early stopping is not supported`),
      );
    }
    if ((step?.artifacts?.length ?? 0) > 0) {
      return yield* Effect.fail(unsupported(`Harbor ${label} artifacts are not supported`));
    }
    if ((step?.verifier?.collect?.length ?? 0) > 0) {
      return yield* Effect.fail(
        unsupported(`Harbor ${label} verifier collect hooks are not supported`),
      );
    }
    if (step?.verifier?.environment_mode === "shared" && step.verifier.environment !== undefined) {
      return yield* Effect.fail(
        invalid(
          `Harbor ${label} verifier.environment is incompatible with environment_mode = "shared"`,
        ),
      );
    }
    if (verifierMode(config.verifier, step?.verifier) === "separate") {
      return yield* Effect.fail(
        unsupported(`Harbor ${label} separate verifier environment is not supported`),
      );
    }

    for (const issue of [
      validateNetwork(`${label}.agent`, step?.agent),
      validateNetwork(`${label}.verifier`, step?.verifier),
    ]) {
      if (issue !== undefined) {
        return yield* Effect.fail(issue);
      }
    }

    const phases: ReadonlyArray<readonly [string, AgentConfig | VerifierConfig | undefined]> = [
      ["agent", phaseConfig(config.agent, step?.agent)],
      ["verifier", phaseConfig(config.verifier, step?.verifier)],
    ];
    for (const [phase, phaseCfg] of phases) {
      if (phaseCfg?.network_mode === undefined) {
        continue;
      }
      const hosts = phaseCfg.allowed_hosts ?? [];
      if (
        phaseCfg.network_mode !== baseMode ||
        JSON.stringify(hosts) !== JSON.stringify(baseHosts)
      ) {
        return yield* Effect.fail(
          unsupported(`Dynamic Harbor ${label} ${phase} network policy is not supported`),
        );
      }
    }

    const verifier = step?.verifier?.user ?? config.verifier?.user;
    if (verifier !== undefined && !sameUser(verifier, agent)) {
      return yield* Effect.fail(
        unsupported(`Harbor ${label} verifier user must match the effective agent user`),
      );
    }
  }

  for (const [key, value] of Object.entries(env?.env ?? {})) {
    if (/\$\{[^}]+\}/.test(value)) {
      return yield* Effect.fail(
        unsupported(`Harbor environment variable ${key} requires host-side interpolation`),
      );
    }
  }
});

const snapshotInstructions = (config: TaskConfig): Snapshot.Instructions => {
  const env = config.environment;
  const instructions: Array<Snapshot.Instruction> = [];
  if (env?.env !== undefined && Object.keys(env.env).length > 0) {
    instructions.push(Snapshot.Inst.env(env.env));
  }
  if (env?.workdir !== undefined) {
    instructions.push(Snapshot.Inst.workdir(env.workdir));
  }
  const user = agentUser(config);
  if (user !== undefined) {
    instructions.push(Snapshot.Inst.user(String(user)));
  }
  return instructions;
};

export const makeSnapshot = Effect.fn("Task.Load.makeHarborSnapshot")(function* (
  taskDir: string,
  config: TaskConfig,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const envDir = path.resolve(taskDir, "environment");
  const instructions = snapshotInstructions(config);

  if (config.environment?.docker_image !== undefined) {
    return Snapshot.make({
      image: config.environment.docker_image,
      context: envDir,
      instructions,
    });
  }

  const dockerfile = path.join(envDir, "Dockerfile");
  if (!(yield* fs.exists(dockerfile).pipe(Effect.mapError(TasksError.source)))) {
    return yield* Effect.fail(
      unsupported("Harbor task requires environment.docker_image or environment/Dockerfile"),
    );
  }
  if (instructions.length === 0) {
    return yield* Snapshot.build({ filePath: dockerfile, context: envDir }).pipe(
      Effect.mapError(TasksError.init),
    );
  }

  const source = yield* fs.readFileString(dockerfile).pipe(Effect.mapError(TasksError.source));
  const tempDir = yield* fs.makeTempDirectoryScoped({
    prefix: "open-insight-harbor-containerfile-",
  });
  const file = path.join(tempDir, "Dockerfile");
  const suffix = Snapshot.encode({ image: "scratch", instructions })
    .split("\n")
    .slice(1)
    .join("\n");
  yield* fs
    .writeFileString(file, `${source.trimEnd()}\n${suffix}`)
    .pipe(Effect.mapError(TasksError.source));
  return yield* Snapshot.build({ filePath: file, context: envDir }).pipe(
    Effect.mapError(TasksError.init),
  );
});

const timeout = (config: TaskConfig): number => {
  const timeouts = [
    config.agent?.timeout_sec ?? 600,
    config.verifier?.timeout_sec ?? 600,
    ...(config.steps ?? []).flatMap((step) => [
      step.agent?.timeout_sec ?? config.agent?.timeout_sec ?? 600,
      step.verifier?.timeout_sec ?? config.verifier?.timeout_sec ?? 600,
    ]),
  ];
  return Math.ceil(Math.max(...timeouts));
};

export const makeResources = (config: TaskConfig): Resource.Resources => {
  const env = config.environment;
  return Resource.make({
    numCPUs: env?.cpus ?? 1,
    numGPUs: env?.gpus ?? 0,
    memoryMiB: env?.memory_mb ?? 2048,
    storageMiB: env?.storage_mb ?? 10240,
    network: networkPolicy(env),
    buildTimeoutSec: Math.ceil(env?.build_timeout_sec ?? 600),
    runTimeoutSec: timeout(config),
  });
};

export const author = ({
  name,
  email,
}: {
  readonly name: string;
  readonly email?: string;
}): string => (email === undefined ? name : `${name} <${email}>`);
