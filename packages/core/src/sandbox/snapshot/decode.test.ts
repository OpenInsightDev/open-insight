import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { Snapshot } from "./build.ts";
import { decode, encode } from "./decode.ts";
import { Instruction } from "./inst.ts";

const assertDecodeFails = (containerfile: string, message: string) =>
  Effect.gen(function* () {
    const error = yield* decode(containerfile).pipe(Effect.flip);

    assert.isTrue(
      String(error).includes(message),
      `Expected decode failure to include ${JSON.stringify(message)}, got ${String(error)}`,
    );
  });

it.effect("decodes supported snapshot instructions", () =>
  Effect.gen(function* () {
    const snapshot = yield* decode(`
FROM denoland/deno:alpine
WORKDIR /workspace
USER deno:deno
RUN deno --version
ENV DENO_DIR=/deno-dir MODE=test
COPY . /workspace
COPY ["src/app.ts", "src/config.json", "/workspace/src/"]
CMD ["deno", "test"]
ENTRYPOINT ["deno"]
`);

    assert.strictEqual(snapshot.image, "denoland/deno:alpine");
    assert.deepStrictEqual(snapshot.instructions, [
      { _tag: "Workdir", path: "/workspace" },
      { _tag: "User", user: "deno:deno" },
      { _tag: "Run", cmd: "deno --version" },
      { _tag: "Env", env: { DENO_DIR: "/deno-dir", MODE: "test" } },
      { _tag: "Copy", src: ["."], dest: "/workspace" },
      { _tag: "Copy", src: ["src/app.ts", "src/config.json"], dest: "/workspace/src/" },
      { _tag: "Cmd", cmd: ["deno", "test"] },
      { _tag: "Entrypoint", cmd: ["deno"] },
    ]);
  }),
);

it.effect("encodes snapshots to deterministic Containerfile text", () =>
  Effect.gen(function* () {
    const containerfile = yield* encode(
      Snapshot.make({
        image: "node:22-alpine",
        instructions: [
          Instruction.make({ _tag: "Env", env: { ZED: "last", ALPHA: "first" } }),
          Instruction.make({ _tag: "Copy", src: ["package.json", "src"], dest: "/app/" }),
          Instruction.make({ _tag: "Cmd", cmd: ["node", "src/index.js"] }),
        ],
      }),
    );

    assert.strictEqual(
      containerfile,
      [
        "FROM node:22-alpine",
        "ENV ALPHA=first ZED=last",
        'COPY ["package.json","src","/app/"]',
        'CMD ["node","src/index.js"]',
        "",
      ].join("\n"),
    );
  }),
);

it.effect.each([
  {
    name: "missing FROM",
    containerfile: "RUN echo ok\n",
    message: "Expected exactly one FROM instruction, found 0",
  },
  {
    name: "multiple FROM instructions",
    containerfile: "FROM alpine\nFROM debian\n",
    message: "Expected exactly one FROM instruction, found 2",
  },
  {
    name: "unsupported instruction",
    containerfile: "FROM alpine\nADD . /app\n",
    message: "ADD instruction is not supported by Snapshot",
  },
  {
    name: "RUN flags",
    containerfile: "FROM alpine\nRUN --mount=type=cache echo ok\n",
    message: "RUN flags are not supported by Snapshot",
  },
  {
    name: "COPY flags",
    containerfile: "FROM alpine\nCOPY --chown=node:node package.json /app/\n",
    message: "COPY flags are not supported by Snapshot",
  },
  {
    name: "shell-form CMD",
    containerfile: "FROM alpine\nCMD echo ok\n",
    message: "CMD must use JSON array form",
  },
  {
    name: "shell-form ENTRYPOINT",
    containerfile: "FROM alpine\nENTRYPOINT deno\n",
    message: "ENTRYPOINT must use JSON array form",
  },
  {
    name: "COPY without destination",
    containerfile: "FROM alpine\nCOPY only\n",
    message: "COPY must include at least one source and one destination",
  },
  {
    name: "ENV without value",
    containerfile: "FROM alpine\nENV ONLY_KEY\n",
    message: "ENV ONLY_KEY is missing a value",
  },
])("rejects $name", ({ containerfile, message }) => assertDecodeFails(containerfile, message));
