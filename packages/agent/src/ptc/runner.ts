/**
 * The PTC script runner.
 *
 * An agent script (a TypeScript string) goes through three stages, mirroring
 * the Programmatic Tool Calling workflow:
 *
 *  1. **Type check** — forwarded to the real `tsgo` (native TypeScript)
 *     compiler. This validates the agent's code against the generated
 *     `sdk.d.ts` globals, so the agent gets precise diagnostics before running.
 *  2. **Compile** — `tsgo` type-strips and emits plain JavaScript (`agent.js`).
 *  3. **Run** — the emitted JS is executed inside an isolated `node:vm`
 *     context seeded with a captured `console` and the host `__ptc` bridge.
 *
 * **Script contract**: the agent writes a single `async function main`. Its
 * awaits (e.g. `await Execute(...)`) are ordinary JS, no top-level `await` or
 * module syntax required. The runner evaluates the script (declaring `main`),
 * then invokes `main()` via `vm.runInContext` and resolves its returned
 * Promise to obtain `RunResult.result`. This uses vm's native completion-value
 * mechanism — no source parsing or string rewriting.
 *
 * The SDK runtime (`sdk.mjs`) is evaluated into the same context first, which
 * installs the per-tool global functions the agent calls.
 */
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Context, Effect, Layer } from "effect";
import { Vm } from "#/vm/export.ts";
import { PtcError } from "./error.ts";
import type { SdkAssets } from "./sdk.ts";

/** The structured outcome of running an agent script. */
export type RunResult = Readonly<{
  /** Everything the agent wrote to `console.log`/`console.error`. */
  readonly stdout: string;
  /** The resolved value of the agent's `async function main`. */
  readonly result: unknown;
}>;

/** Options controlling the compile/run stages. */
export type RunOptions = Readonly<{
  /** Milliseconds to wait for the (async) agent script before declaring it stuck. */
  readonly timeout?: number;
  /** Filename used for diagnostics. Defaults to `"agent.ts"`. */
  readonly scriptName?: string;
}>;

/** Resolve the native TypeScript entry point shipped with the `typescript` package. */
const tscEntry = (): string => {
  const require_ = createRequire(import.meta.url);
  const pkg = require_.resolve("typescript/package.json");
  return join(dirname(pkg), "lib", "tsc.js");
};

const TSCONFIG = {
  compilerOptions: {
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    verbatimModuleSyntax: true,
  },
};

/** Run the `tsgo` binary, returning `{ stdout, stderr, code }`. */
const runTsgo = (
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<{ stdout: string; stderr: string; code: number }, PtcError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        execFile(process.execPath, [tscEntry(), ...args], { cwd }, (error, stdout, stderr) => {
          resolve({
            stdout,
            stderr,
            code: error && typeof error.code === "number" ? error.code : error ? -1 : 0,
          });
        });
      }),
    catch: (cause) => PtcError.compileFailed(cause),
  });

/** Materialise the agent script + SDK into a scratch dir and scope its lifetime. */
const withScratch = <A>(
  script: string,
  assets: SdkAssets,
  scriptName: string,
  evaluate: (dir: string) => Effect.Effect<A, PtcError>,
): Effect.Effect<A, PtcError> =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const dir = await mkdtemp(join(tmpdir(), "ptc-"));
        await Promise.all([
          writeFile(join(dir, scriptName), script),
          writeFile(join(dir, "sdk.d.ts"), assets.dts),
          writeFile(
            join(dir, "tsconfig.json"),
            JSON.stringify({ ...TSCONFIG, files: [scriptName, "sdk.d.ts"] }, null, 2),
          ),
        ]);
        return dir;
      },
      catch: (cause) => PtcError.compileFailed(cause),
    }),
    (dir) => Effect.tryPromise(() => rm(dir, { recursive: true, force: true })).pipe(Effect.ignore),
  ).pipe(Effect.flatMap(evaluate), Effect.scoped);

/**
 * Type-check `script` against the generated SDK declarations.
 *
 * @returns `void` on success, or fails with `TypeCheckFailed` on diagnostics.
 */
export const typecheck = (
  script: string,
  assets: SdkAssets,
  options: RunOptions = {},
): Effect.Effect<void, PtcError> => {
  const scriptName = options.scriptName ?? "agent.ts";
  return withScratch(script, assets, scriptName, (dir) =>
    runTsgo(dir, ["-p", "tsconfig.json"]).pipe(
      Effect.flatMap(({ stdout, stderr, code }) => {
        const diagnostics = `${stdout}${stderr}`.trim();
        if (code !== 0) {
          return Effect.fail(PtcError.typeCheckFailed(scriptName, diagnostics));
        }
        return Effect.void;
      }),
    ),
  );
};

/**
 * Type-strip and compile `script` into plain JavaScript.
 *
 * @returns the emitted JavaScript source, or fails on type/compile errors.
 */
export const compile = (
  script: string,
  assets: SdkAssets,
  options: RunOptions = {},
): Effect.Effect<string, PtcError> => {
  const scriptName = options.scriptName ?? "agent.ts";
  return withScratch(script, assets, scriptName, (dir) =>
    Effect.gen(function* () {
      const emitConfig = {
        ...TSCONFIG,
        compilerOptions: { ...TSCONFIG.compilerOptions, noEmit: false, outDir: "./out" },
        files: [scriptName, "sdk.d.ts"],
      };
      yield* Effect.tryPromise({
        try: () => writeFile(join(dir, "tsconfig.emit.json"), JSON.stringify(emitConfig, null, 2)),
        catch: (cause) => PtcError.compileFailed(cause),
      });
      const result = yield* runTsgo(dir, ["-p", "tsconfig.emit.json"]);
      if (result.code !== 0) {
        return yield* Effect.fail(
          PtcError.typeCheckFailed(scriptName, `${result.stdout}${result.stderr}`.trim()),
        );
      }
      const jsName = scriptName.replace(/\.tsx?$/, ".js");
      return yield* Effect.tryPromise({
        try: () => readFile(join(dir, "out", jsName), "utf8"),
        catch: (cause) => PtcError.compileFailed(cause),
      });
    }),
  );
};

/**
 * Run pre-compiled JavaScript inside an isolated `node:vm` context. The SDK
 * runtime is evaluated first, installing per-tool globals that delegate to the
 * host `__ptc` bridge.
 */
export const run = (
  js: string,
  assets: SdkAssets,
  vmCall: (name: string, args: unknown) => Promise<unknown>,
  options: RunOptions = {},
): Effect.Effect<RunResult, PtcError, Vm> =>
  Effect.gen(function* () {
    const vm = yield* Vm;
    const logs: Array<string> = [];
    const console_ = {
      log: (...a: ReadonlyArray<unknown>) => logs.push(a.map(String).join(" ")),
      info: (...a: ReadonlyArray<unknown>) => logs.push(a.map(String).join(" ")),
      warn: (...a: ReadonlyArray<unknown>) => logs.push(a.map(String).join(" ")),
      error: (...a: ReadonlyArray<unknown>) => logs.push(a.map(String).join(" ")),
    };

    const context = vm.createContext({ console: console_, __ptc: vmCall });
    // 1. Install the SDK globals (`Execute`, ...) that delegate to `__ptc`.
    yield* vm
      .runInContext(assets.runtime, context)
      .pipe(Effect.mapError((cause) => PtcError.runtimeFailed(cause)));

    // 2. Evaluate the agent script, which must declare an `async function main`.
    yield* vm
      .runInContext(js, context)
      .pipe(Effect.mapError((cause) => PtcError.runtimeFailed(cause)));

    // 3. Invoke `main()` through vm's own mechanism. The completion value is a
    //    Promise (async function) that resolves to the program's result — no
    //    source wrapping or parsing is involved.
    const promise = yield* vm
      .runInContext("main()", context)
      .pipe(Effect.mapError((cause) => PtcError.runtimeFailed(cause)));

    const result = yield* Effect.promise<unknown>(() => {
      const timeout = options.timeout ?? 30_000;
      return new Promise((resolve, reject) => {
        const killer = setTimeout(
          () => reject(new Error(`agent script timed out after ${timeout}ms`)),
          timeout,
        );
        Promise.resolve(promise)
          .then((value) => {
            clearTimeout(killer);
            resolve(value);
          })
          .catch((cause) => {
            clearTimeout(killer);
            reject(cause);
          });
      });
    }).pipe(Effect.mapError((cause) => PtcError.runtimeFailed(cause)));

    return { stdout: logs.join("\n"), result };
  });

export type RunnerService = Readonly<{
  readonly typecheck: typeof typecheck;
  readonly compile: typeof compile;
  readonly run: typeof run;
}>;

export class Runner extends Context.Service<Runner, RunnerService>()("open-insight/Ptc/Runner") {
  static readonly layer: Layer.Layer<Runner> = Layer.succeed(
    Runner,
    Runner.of({ typecheck, compile, run }),
  );
}
