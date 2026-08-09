import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import { Vm, VmError } from "#/vm/export.ts";

const getReasonTag = <A>(effect: Effect.Effect<A, VmError, Vm>) =>
  Effect.match(effect.pipe(Effect.provide(Vm.layer)), {
    onSuccess: () => ({ ok: true }),
    onFailure: (error) => ({ ok: false, tag: error.reason._tag }),
  });

describe("Vm", () => {
  it("runs code in a new context", async () => {
    const run = Effect.gen(function* () {
      const vm = yield* Vm;
      return yield* vm.runInNewContext("const x = 40; x + 2;");
    });
    expect(await Effect.runPromise(run.pipe(Effect.provide(Vm.layer)))).toBe(42);
  });

  it("runs a compiled Script repeatedly against a shared context", async () => {
    const run = Effect.gen(function* () {
      const vm = yield* Vm;
      const script = yield* vm.script("count += 1; count;");
      const sandbox = vm.createContext({ count: 0 });
      const a = yield* script.runInContext(sandbox);
      const b = yield* script.runInContext(sandbox);
      return [a, b, sandbox.count];
    });
    expect(await Effect.runPromise(run.pipe(Effect.provide(Vm.layer)))).toEqual([1, 2, 2]);
  });

  it("reports invalid source as CompileFailure", async () => {
    const run = Effect.gen(function* () {
      const vm = yield* Vm;
      return yield* vm.runInNewContext("const = ;");
    });
    expect(await Effect.runPromise(getReasonTag(run))).toEqual({
      ok: false,
      tag: "CompileFailure",
    });
  });

  it("reports a non-terminating script as ExecutionTimeout", async () => {
    const run = Effect.gen(function* () {
      const vm = yield* Vm;
      return yield* vm.runInNewContext("while (true) {}", undefined, { timeout: 10 });
    });
    expect(await Effect.runPromise(getReasonTag(run))).toEqual({
      ok: false,
      tag: "ExecutionTimeout",
    });
  });

  it("reports a non-contextified sandbox as InvalidContext", async () => {
    const run = Effect.gen(function* () {
      const vm = yield* Vm;
      return yield* vm.runInContext("1", {} as never);
    });
    expect(await Effect.runPromise(getReasonTag(run))).toEqual({
      ok: false,
      tag: "InvalidContext",
    });
  });
});
