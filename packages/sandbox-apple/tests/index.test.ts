import { describe, expect, it } from "vite-plus/test";

describe("@open-insight/sandbox-apple", () => {
  it("should export the `make` function", async () => {
    const mod = await import("../src/index.ts");
    expect(mod.make).toBeDefined();
    expect(typeof mod.make).toBe("function");
  });
});
