import { assert, it } from "@effect/vitest";
import * as Snapshot from "#/Snapshot.ts";

it("encodes instructions as a Containerfile", () => {
  const containerfile = Snapshot.encode({
    image: "alpine:latest",
    instructions: [
      Snapshot.workdir("/workspace"),
      Snapshot.env({ B: "2", A: "1" }),
      Snapshot.copy(["./src"], "/workspace", { chmod: "0755" }),
      Snapshot.run("apk add curl", { network: "host" }),
      Snapshot.cmd("node", "index.js"),
    ],
  });

  assert.strictEqual(
    containerfile,
    [
      "FROM alpine:latest",
      "WORKDIR /workspace",
      'ENV A="1" B="2"',
      'COPY --chmod=0755 ["./src","/workspace"]',
      "RUN --network=host apk add curl",
      'CMD ["node","index.js"]',
      "",
    ].join("\n"),
  );
});

it("builds assertion instructions for required programs", () => {
  const containerfile = Snapshot.encode({
    image: "alpine:latest",
    instructions: [Snapshot.assert("a", "b"), Snapshot.available("git")],
  });

  assert.strictEqual(
    containerfile,
    ["FROM alpine:latest", "RUN a && b || exit 1", "RUN command -v git || exit 1", ""].join("\n"),
  );
});

it("starts templates from an image with a keep-alive command", () => {
  const template = Snapshot.fromImage("debian:latest");

  assert.strictEqual(template._tag, "Instructions");
  assert.strictEqual(template.image, "debian:latest");
  assert.deepStrictEqual(template.instructions, [Snapshot.cmd("sleep", "infinity")]);
  assert.strictEqual(template.context, "/tmp");
});
