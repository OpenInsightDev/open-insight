import { describe, expect, it, vi } from "vite-plus/test";
import { Effect, FileSystem } from "effect";
import { SandboxError } from "@open-insight/core";
import { toSandbox } from "../src/index.ts";
import type { ComputeSandbox } from "../src/index.ts";

const makeSandbox = (overrides: Partial<ComputeSandbox> = {}): ComputeSandbox => ({
  sandboxId: "sb-test",
  provider: "e2b",
  runCommand: async (command) => ({
    stdout: `out:${command}`,
    stderr: "",
    exitCode: 0,
    durationMs: 1,
  }),
  getUrl: async ({ port }) => `https://sb-test.example.com/${port}`,
  destroy: async () => {},
  filesystem: {
    readFile: async (path) => `content:${path}`,
    writeFile: async () => {},
    readdir: async () => [],
    mkdir: async () => {},
    exists: async () => true,
    remove: async () => {},
  },
  ...overrides,
});

/** In-memory host FileSystem used to satisfy `toSandbox`'s `FileSystem` requirement. */
const makeHostFs = () => {
  const store = new Map<string, string>();
  const layer = FileSystem.layerNoop({
    writeFileString: (path, data) =>
      Effect.sync(() => {
        store.set(path, data);
      }),
    readFileString: (path) => Effect.sync(() => store.get(path) ?? ""),
  });
  return { layer, store };
};

const toEffectSandbox = (sandbox: ComputeSandbox, host = makeHostFs()) =>
  Effect.runPromise(toSandbox(sandbox).pipe(Effect.provide(host.layer)));

describe("toSandbox", () => {
  it("cmd runs the reconstructed command string through runCommand", async () => {
    const runCommand = vi.fn(async (command: string) => ({
      stdout: `out:${command}`,
      stderr: "",
      exitCode: 0,
      durationMs: 5,
    }));
    const sandbox = await toEffectSandbox(
      makeSandbox({ runCommand: runCommand as ComputeSandbox["runCommand"] }),
    );

    const handle = await Effect.runPromise(sandbox.cmd({ command: "echo", args: ["hi"] }));
    expect(handle.exitCode).toBe(0);
    expect(handle.stdout).toBe("out:'echo' 'hi'");
    expect(handle.stderr).toBe("");
    expect(runCommand).toHaveBeenCalledWith("'echo' 'hi'", {});
  });

  it("cmd fails with a SandboxError on non-zero exit", async () => {
    const sandbox = await toEffectSandbox(
      makeSandbox({
        runCommand: async () => ({ stdout: "", stderr: "boom", exitCode: 1, durationMs: 1 }),
      }),
    );

    const error = await Effect.runPromise(sandbox.cmd({ command: "false" }).pipe(Effect.flip));
    expect(error).toBeInstanceOf(SandboxError);
    expect(error.message).toContain("sb-test");
  });

  it("exitCode surfaces non-zero exits while success fails on them", async () => {
    const sandbox = await toEffectSandbox(
      makeSandbox({
        runCommand: async () => ({ stdout: "", stderr: "boom", exitCode: 3, durationMs: 1 }),
      }),
    );

    await expect(Effect.runPromise(sandbox.exitCode({ command: "false" }))).resolves.toBe(3);
    await expect(
      Effect.runPromise(sandbox.success({ command: "false" }).pipe(Effect.flip)),
    ).resolves.toMatchObject({ reason: { exitCode: 3 } });
  });

  it("readFile and writeFile delegate to the filesystem", async () => {
    const readFile = vi.fn(async (path: string) => `data:${path}`);
    const writeFile = vi.fn(async () => {});
    const sandbox = await toEffectSandbox(
      makeSandbox({
        filesystem: {
          ...makeSandbox().filesystem,
          readFile: readFile as ComputeSandbox["filesystem"]["readFile"],
          writeFile: writeFile as ComputeSandbox["filesystem"]["writeFile"],
        },
      }),
    );

    expect(await Effect.runPromise(sandbox.readFile({ sandboxPath: "/etc/hosts" }))).toBe(
      "data:/etc/hosts",
    );
    await Effect.runPromise(sandbox.writeFile({ sandboxPath: "/tmp/a", content: "hello" }));
    expect(writeFile).toHaveBeenCalledWith("/tmp/a", "hello");
  });

  it("download and upload bridge between the sandbox and host filesystem", async () => {
    const host = makeHostFs();
    host.store.set("/host/source.txt", "host content");

    const writeFile = vi.fn(async () => {});
    const readFile = vi.fn(async (path: string) => `content:${path}`);
    const filledSandbox = await toEffectSandbox(
      makeSandbox({
        filesystem: {
          ...makeSandbox().filesystem,
          readFile: readFile as ComputeSandbox["filesystem"]["readFile"],
          writeFile: writeFile as ComputeSandbox["filesystem"]["writeFile"],
        },
      }),
      host,
    );

    await Effect.runPromise(
      filledSandbox.download({ sandboxPath: "/sandbox/remote.txt", hostPath: "/host/dest.txt" }),
    );
    expect(host.store.get("/host/dest.txt")).toBe("content:/sandbox/remote.txt");

    await Effect.runPromise(
      filledSandbox.upload({ sandboxPath: "/sandbox/remote.txt", hostPath: "/host/source.txt" }),
    );
    expect(writeFile).toHaveBeenCalledWith("/sandbox/remote.txt", "host content");
  });

  it("expose maps getUrl to the host URL", async () => {
    const sandbox = await toEffectSandbox(makeSandbox());
    expect(await Effect.runPromise(sandbox.expose({ sandboxPort: 8080 }))).toEqual({
      hostUrl: "https://sb-test.example.com/8080",
    });
  });
});
