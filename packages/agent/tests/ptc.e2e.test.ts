import { describe, expect, it } from "vite-plus/test";
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { Effect, Layer } from "effect";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import { Sandbox } from "@open-insight/core";
import { Vm } from "#/vm/export.ts";
import { Volume } from "memfs";
import { Bridge, makeBridge, Ptc, PtcError } from "#/ptc/export.ts";
import { toolkit, layer as sandboxLayer } from "#/sandbox/export.ts";
/**
 * A fake `Sandbox.Current` that backs `readFile`/`writeFile` with an in-memory
 * volume and `spawn` on the host — enough to exercise the real sandbox toolkit
 * (Execute / ReadFile / WriteFile) without docker.
 */
const makeSandbox = (vol: Volume): Sandbox.Sandbox => {
  const spawn: Sandbox.Sandbox["spawn"] = (command) =>
    Effect.tryPromise(async () => {
      const { stdout, stderr, code } = await new Promise<{
        stdout: string;
        stderr: string;
        code: ExitCode;
      }>((resolve) => {
        execFile(
          command.command,
          command.args ?? [],
          { cwd: command.cwd, env: { ...process.env, ...command.env } },
          (error, so, se) => {
            resolve({
              stdout: so,
              stderr: se,
              code: ExitCode(error && typeof error.code === "number" ? error.code : error ? 1 : 0),
            });
          },
        );
      });
      return { exitCode: code, stdout, stderr };
    });

  return {
    spawn,
    exitCode: (command) => spawn(command).pipe(Effect.map((r) => r.exitCode)),
    success: (command) => spawn(command).pipe(Effect.asVoid),
    stdout: (command) => spawn(command).pipe(Effect.map((r) => r.stdout)),
    stderr: (command) => spawn(command).pipe(Effect.map((r) => r.stderr)),
    readFile: ({ sandboxPath }) =>
      Effect.try(() => String(vol.readFileSync(sandboxPath, "utf8"))).pipe(
        Effect.mapError((cause) => Sandbox.SandboxError.sandboxExec("test", "readFile")(cause)),
      ),
    writeFile: ({ sandboxPath, content }) =>
      Effect.try(() => {
        vol.mkdirSync(dirname(sandboxPath), { recursive: true });
        vol.writeFileSync(sandboxPath, content);
      }).pipe(
        Effect.asVoid,
        Effect.mapError((cause) => Sandbox.SandboxError.sandboxExec("test", "writeFile")(cause)),
      ),
    download: () => Effect.die(new Error("unimplemented in test")),
    upload: () => Effect.die(new Error("unimplemented in test")),
    expose: () => Effect.die(new Error("unimplemented in test")),
  };
};

const buildBridge = (vol: Volume): Layer.Layer<Bridge> => {
  const sandbox = Layer.succeed(Sandbox.Current, makeSandbox(vol));
  // Arm the bare sandbox toolkit with its handlers, then build the bridge layer.
  return Layer.effect(
    Bridge,
    Effect.provide(toolkit, [sandboxLayer, sandbox]).pipe(
      Effect.flatMap((withHandler) => makeBridge(withHandler, sandbox)),
    ),
  );
};

describe("ptc end-to-end", () => {
  it("type-checks, compiles and runs an agent script that routes to real tools", async () => {
    const vol = new Volume();
    const bridge = buildBridge(vol);
    const program = Effect.gen(function* () {
      const ptc = yield* Ptc;
      return yield* ptc.run(`
        async function main() {
          const write = await WriteFile({ path: "/w/hello.txt", content: "hi baz" });
          const read = await ReadFile({ path: "/w/hello.txt" });
          const exec = await Execute({ command: "sh", args: ["-c", "printf 'count=%d' 41"], env: { GREETING: "hi" } });
          const ok = read.ok && exec.ok;
          console.log(ok ? [read.value, exec.value.stdout].join("|") : "failed");
          return read.ok ? read.value : "failed";
        }
      `);
    });

    const out = await Effect.runPromise(
      Effect.scoped(Effect.provide(program, [Ptc.layer(bridge), Vm.layer])),
    );
    expect(out.result).toBe("hi baz");
    expect(out.stdout).toBe("hi baz|count=41");
  });

  it("reports a type error before running", async () => {
    const vol = new Volume();
    const bridge = buildBridge(vol);
    const program = Effect.gen(function* () {
      const ptc = yield* Ptc;
      return yield* ptc.run(`
        async function main() {
          const n: number = WriteFile({ path: "/x", content: "a" });
          return n;
        }
      `);
    });

    await expect(
      Effect.runPromise(Effect.scoped(Effect.provide(program, [Ptc.layer(bridge), Vm.layer]))),
    ).rejects.toMatchObject({ reason: { _tag: "TypeCheckFailed" } });
  });

  it("fails with ToolNotFound for an unknown bridge call", async () => {
    const vol = new Volume();
    const program = Effect.gen(function* () {
      const b = yield* Bridge;
      return yield* Effect.flip(b.call("Nope", {}));
    });
    const error = await Effect.runPromise(Effect.provide(program, buildBridge(vol)));
    expect(error).toBeInstanceOf(PtcError);
    expect(error.reason._tag).toBe("ToolNotFound");
  });

  it("seeds the SDK layout into an in-memory file system", async () => {
    const files: Record<string, string> = {};
    const bridge = buildBridge(new Volume());
    const program = Effect.gen(function* () {
      const ptc = yield* Ptc;
      return yield* ptc.seed({
        writeFileString: (p: string, c: string) => Effect.sync(() => void (files[p] = c)),
      } as never);
    });
    await Effect.runPromise(Effect.scoped(Effect.provide(program, [Ptc.layer(bridge), Vm.layer])));
    expect(Object.keys(files).sort()).toEqual(["sdk.d.ts", "sdk.mjs"]);
    expect(files["sdk.d.ts"]).toContain("declare global {");
    expect(files["sdk.mjs"]).toContain("globalThis.__ptc");
  });
});
