import { describe, expect, it } from "vite-plus/test";
import { toolSpecs } from "./sdk.test.helpers.ts";
import { generate } from "./sdk.ts";

describe("ptc/sdk generate", () => {
  const assets = generate(toolSpecs);

  it("declares a global function per tool with expanded schema types", () => {
    expect(assets.dts).toContain("function Greet");
    expect(assets.dts).toContain("function Add");
    expect(assets.dts).toContain("Promise<CallResult<GreetResult>>");
    expect(assets.dts).toContain("type GreetArgs");
    expect(assets.dts).toContain("declare global {");
    expect(assets.dts).toContain("export {};");
  });

  it("produces a runnable runtime delegating to the __ptc bridge", () => {
    expect(assets.runtime).toContain("const call = globalThis.__ptc;");
    expect(assets.runtime).toContain('function Greet(args) { return call("Greet", args); }');
    expect(assets.runtime).toContain("globalThis.Greet = Greet;");
  });

  it("lays the SDK out as sdk.d.ts and sdk.mjs", () => {
    expect(Object.keys(assets.files).sort()).toEqual(["sdk.d.ts", "sdk.mjs"]);
    expect(assets.files["sdk.d.ts"]).toBe(assets.dts);
    expect(assets.files["sdk.mjs"]).toBe(assets.runtime);
  });

  it("expands required fields into non-optional properties", () => {
    expect(assets.dts).toMatch(/type AddArgs\s*=\s*\{\s*readonly "a": number/);
  });
});
