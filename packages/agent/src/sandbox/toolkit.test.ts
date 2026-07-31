import { assert, it } from "@effect/vitest";
import { Sandbox } from "@open-insight/core";
import { Effect, Schema, Stream } from "effect";
import { OpenAiStructuredOutput, Tool } from "effect/unstable/ai";
import { Execute, layer, toolkit } from "#/sandbox/index.ts";

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
                "0": Schema.Unknown,
                "1": Schema.Unknown,
              }),
            }),
          }),
          Schema.Struct({ type: Schema.Literal("null") }),
        ]),
      ),
    }),
  }),
});

it.effect("uses an environment record at the tool boundary", () =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(Execute.parametersSchema)({
      command: "env",
      env: { PATH: "/usr/bin", MODE: "test" },
    });
    assert.deepStrictEqual(decoded, {
      command: "env",
      env: { PATH: "/usr/bin", MODE: "test" },
    });

    const encoded = yield* Schema.encodeUnknownEffect(Execute.parametersSchema)(decoded);
    assert.deepStrictEqual(encoded, {
      command: "env",
      env: { PATH: "/usr/bin", MODE: "test" },
    });
  }),
);

it.effect("accepts provider-decoded environment records", () =>
  Effect.gen(function* () {
    const providerCodec = OpenAiStructuredOutput.toCodecOpenAI(Execute.parametersSchema).codec;
    const providerDecoded = yield* Schema.decodeUnknownEffect(providerCodec)({
      command: "env",
      env: [
        { 0: "PATH", 1: "/usr/bin" },
        { 0: "MODE", 1: "test" },
      ],
    });
    const decoded = yield* Schema.decodeUnknownEffect(Execute.parametersSchema)(providerDecoded);

    assert.deepStrictEqual(decoded, {
      command: "env",
      env: { PATH: "/usr/bin", MODE: "test" },
    });
  }),
);

it.effect("emits a closed strict provider schema for environment entries", () =>
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
      assert.deepStrictEqual(environment.items.required, ["0", "1"]);
    }
  }),
);

it.effect("returns actionable failure details to the model", () =>
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
      .handle("WriteFile", {
        path: "/missing/top.v",
        content: "module TopModule; endmodule",
      })
      .pipe(Effect.flatMap(Stream.runCollect), Effect.provideService(Sandbox.Current, sandbox));
    const result = Array.from(results)[0]?.result;

    assert.strictEqual(typeof result, "string");
    if (typeof result === "string") {
      assert.include(result, "Failed to write /missing/top.v");
      assert.include(result, "parent directory does not exist");
    }
  }),
);
