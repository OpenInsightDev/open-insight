import { assert, it } from "@effect/vitest";
import { Sandbox } from "@open-insight/core";
import { Effect, Schema, Stream } from "effect";
import { OpenAiStructuredOutput, Tool } from "effect/unstable/ai";
import { Execute, layer, toolkit } from "#/toolkit.ts";

const StrictEnvironmentToolSchema = Schema.Struct({
  type: Schema.Literal("object"),
  additionalProperties: Schema.Literal(false),
  required: Schema.Array(Schema.String),
  properties: Schema.Struct({
    env: Schema.Struct({
      anyOf: Schema.Array(
        Schema.Union([
          Schema.Struct({
            type: Schema.Literal("array"),
            items: Schema.Struct({
              type: Schema.Literal("object"),
              additionalProperties: Schema.Literal(false),
              required: Schema.Array(Schema.String),
              properties: Schema.Struct({
                name: Schema.Unknown,
                value: Schema.Unknown,
              }),
            }),
          }),
          Schema.Struct({ type: Schema.Literal("null") }),
        ]),
      ),
    }),
  }),
});

it.effect("converts sandbox environment entries at the tool boundary", () =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(Execute.parametersSchema)({
      command: "env",
      env: [
        { name: "PATH", value: "/usr/bin" },
        { name: "MODE", value: "test" },
      ],
    });
    assert.deepStrictEqual(decoded, {
      command: "env",
      env: { PATH: "/usr/bin", MODE: "test" },
    });

    const encoded = yield* Schema.encodeUnknownEffect(Execute.parametersSchema)(decoded);
    assert.deepStrictEqual(encoded, {
      command: "env",
      env: [
        { name: "PATH", value: "/usr/bin" },
        { name: "MODE", value: "test" },
      ],
    });
  }),
);

it.effect("rejects duplicate sandbox environment variable names", () =>
  Effect.gen(function* () {
    const error = yield* Schema.decodeUnknownEffect(Execute.parametersSchema)({
      command: "env",
      env: [
        { name: "PATH", value: "/usr/bin" },
        { name: "PATH", value: "/bin" },
      ],
    }).pipe(Effect.flip);

    assert.include(error.message, "Duplicate environment variable: PATH");
  }),
);

it.effect("emits a closed strict schema for sandbox environment entries", () =>
  Effect.gen(function* () {
    const jsonSchema = Tool.getJsonSchema(Execute, {
      transformer: OpenAiStructuredOutput.toCodecOpenAI,
    });
    const strictSchema = yield* Schema.decodeUnknownEffect(StrictEnvironmentToolSchema)(jsonSchema);
    const environment = strictSchema.properties.env.anyOf.find(
      (candidate) => candidate.type === "array",
    );

    assert.deepStrictEqual(strictSchema.required, ["command", "args", "cwd", "env"]);
    assert.isDefined(environment);
    if (environment?.type === "array") {
      assert.deepStrictEqual(environment.items.required, ["name", "value"]);
    }
  }),
);

it.effect("returns actionable sandbox failure details to the model", () =>
  Effect.gen(function* () {
    const unused = () => Effect.die("unused sandbox method");
    const sandbox: Sandbox.Sandbox = {
      spawn: unused,
      exitCode: unused,
      success: unused,
      stdout: unused,
      stderr: unused,
      cmd: unused,
      readFile: unused,
      writeFile: () =>
        Effect.fail(
          Sandbox.Error.sandboxExec(
            "test-sandbox",
            "write /missing/top.v",
          )(new globalThis.Error("parent directory does not exist")),
        ),
      download: unused,
      upload: unused,
      expose: unused,
    };
    const tools = yield* toolkit.pipe(Effect.provide(layer));
    const results = yield* tools
      .handle("SandboxWriteFile", {
        sandboxPath: "/missing/top.v",
        content: "module TopModule; endmodule",
      })
      .pipe(Effect.flatMap(Stream.runCollect), Effect.provideService(Sandbox.Current, sandbox));
    const result = Array.from(results)[0]?.result;

    assert.strictEqual(typeof result, "string");
    if (typeof result === "string") {
      assert.include(result, "SandboxExecError: write /missing/top.v");
      assert.include(result, "parent directory does not exist");
    }
  }),
);
