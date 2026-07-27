import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Prompt, Sandbox as CoreSandbox, Snapshot } from "@open-insight/core/internal";
import { Effect, FileSystem } from "effect";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import * as Grade from "./index.ts";

const makeSandbox = (
  files: Map<string, string>,
  fs: FileSystem.FileSystem,
): CoreSandbox.Sandbox => {
  const handle = { exitCode: ExitCode(0), stdout: "", stderr: "" };

  return {
    spawn: () => Effect.succeed(handle),
    exitCode: () => Effect.succeed(ExitCode(0)),
    success: () => Effect.void,
    stdout: () => Effect.succeed(""),
    stderr: () => Effect.succeed(""),
    cmd: () => Effect.succeed(handle),
    readFile: ({ sandboxPath }) => Effect.succeed(files.get(sandboxPath) ?? ""),
    writeFile: ({ sandboxPath, content }) =>
      Effect.sync(() => {
        files.set(sandboxPath, content);
      }),
    download: ({ sandboxPath, hostPath }) =>
      fs
        .writeFileString(hostPath, files.get(sandboxPath) ?? "")
        .pipe(Effect.mapError(CoreSandbox.Error.sandboxExec("test", "download"))),
    upload: ({ sandboxPath, hostPath }) =>
      fs.readFileString(hostPath).pipe(
        Effect.tap((content) =>
          Effect.sync(() => {
            files.set(sandboxPath, content);
          }),
        ),
        Effect.asVoid,
        Effect.mapError(CoreSandbox.Error.sandboxExec("test", "upload")),
      ),
    expose: () => Effect.succeed({ hostUrl: "http://localhost" }),
  };
};

describe("sandbox grader", () => {
  layer(NodeServices.layer)((it) => {
    it.effect("uses a fresh grade sandbox and supports copying between sandboxes", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const snapshot = Snapshot.make({ image: "grade-image" });
        const handle = yield* Snapshot.Handle.make(snapshot);
        const agentFiles = new Map([["/workspace/answer.txt", "answer\0payload"]]);
        const gradeSandboxes: Array<Map<string, string>> = [];
        const cacheOptions: Array<boolean | undefined> = [];
        let released = 0;

        const provider: CoreSandbox.Provider = {
          aquireSnapshot: ({ cache }) =>
            Effect.sync(() => {
              cacheOptions.push(cache);
              return handle;
            }),
          deriveSnapshot: () => Effect.die("deriveSnapshot should not be called"),
          runSandbox: () =>
            Effect.acquireRelease(
              Effect.sync(() => {
                const files = new Map<string, string>();
                gradeSandboxes.push(files);
                return makeSandbox(files, fs);
              }),
              () =>
                Effect.sync(() => {
                  released += 1;
                }),
            ),
        };

        const agentSandbox = yield* CoreSandbox.asPromise(makeSandbox(agentFiles, fs));
        const context: Grade.Context<Grade.Results> = {
          ...agentSandbox,
          results: {},
          trajectory: Prompt.empty,
        };
        const grader = Grade.Sandbox.make<{
          fresh: boolean;
          payload: string;
          sandboxNumber: number;
        }>({
          snapshot,
          grade: async ({ grade, copyFromAgent, copyToAgent }) => {
            const fresh = (await grade.readFile({ sandboxPath: "/grade-marker" })) === "";
            await copyFromAgent({
              agentPath: "/workspace/answer.txt",
              gradePath: "/submission/answer.txt",
            });
            const payload = await grade.readFile({
              sandboxPath: "/submission/answer.txt",
            });
            await grade.writeFile({ sandboxPath: "/grade-marker", content: "used" });
            await grade.writeFile({ sandboxPath: "/feedback.txt", content: "checked" });
            await copyToAgent({ gradePath: "/feedback.txt" });
            return { fresh, payload, sandboxNumber: gradeSandboxes.length };
          },
        });

        const run = Grade.Sandbox.run(grader, context).pipe(
          Effect.provideService(CoreSandbox.ProviderService, provider),
        );

        const first = yield* run;
        assert.deepStrictEqual(first, {
          fresh: true,
          payload: "answer\0payload",
          sandboxNumber: 1,
        });
        assert.strictEqual(released, 1);

        const second = yield* run;
        assert.deepStrictEqual(second, {
          fresh: true,
          payload: "answer\0payload",
          sandboxNumber: 2,
        });
        assert.strictEqual(released, 2);
        assert.strictEqual(gradeSandboxes.length, 2);
        assert.notStrictEqual(gradeSandboxes[0], gradeSandboxes[1]);
        assert.deepStrictEqual(cacheOptions, [true, true]);
        assert.strictEqual(agentFiles.get("/feedback.txt"), "checked");
      }),
    );
  });
});
