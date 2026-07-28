import { assert, it } from "@effect/vitest";
import * as Resource from "./index.ts";

it("uses the public network policy by default", () => {
  const resources = Resource.Resources.make({});

  assert.deepStrictEqual(resources.network, Resource.Network.publicAccess());
  assert.strictEqual(resources.numCPUs, 1);
  assert.strictEqual(resources.numGPUs, 0);
  assert.strictEqual(resources.memoryMiB, 512);
  assert.strictEqual(resources.storageMiB, 1024);
});

it("stores an allowlist network policy", () => {
  const network = Resource.Network.allowlist(["pypi.org", "*.pythonhosted.org"]);
  const resources = Resource.Resources.make({ network });

  assert.deepStrictEqual(resources.network, network);
});
