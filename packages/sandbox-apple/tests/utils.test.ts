import { Sandbox } from "@open-insight/core/internal";
import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  formatPortMappings,
  formatResources,
  matchesPortMapping,
  minimumMemoryMiB,
} from "../src/utils.ts";

describe("Apple container sandbox arguments", () => {
  it("formats fixed port mappings", () => {
    assert.deepEqual(formatPortMappings([{ sandboxPort: 8080, hostPort: 18080 }]), [
      "--publish",
      "18080:8080",
    ]);
  });

  it("formats supported resource limits", () => {
    assert.deepEqual(
      formatResources(
        Sandbox.Resources.make({
          numCPUs: 1.5,
          memoryMiB: 256,
        }),
      ),
      ["--cpus", "1.5", "--memory", "256M"],
    );
  });

  it("documents the Apple container minimum memory limit", () => {
    assert.strictEqual(minimumMemoryMiB, 200);
  });

  it("omits unlimited resource limits", () => {
    const unlimited = Schema.decodeUnknownSync(Sandbox.Unlimited)("unlimited");

    assert.deepEqual(
      formatResources(
        Sandbox.Resources.make({
          numCPUs: unlimited,
          memoryMiB: unlimited,
        }),
      ),
      [],
    );
  });

  it("matches configured ports with or without an expected host port", () => {
    const mappings = [{ sandboxPort: 8080, hostPort: 18080 }];

    assert.isTrue(matchesPortMapping(mappings, { sandboxPort: 8080 }));
    assert.isTrue(matchesPortMapping(mappings, { sandboxPort: 8080, hostPort: 18080 }));
    assert.isFalse(matchesPortMapping(mappings, { sandboxPort: 8080, hostPort: 18081 }));
    assert.isFalse(matchesPortMapping(mappings, { sandboxPort: 3000 }));
  });
});
