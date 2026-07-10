import { Effect, Schema } from "effect";
import { Prompt } from "effect/unstable/ai";
import { Snapshot, Task } from "@open-insight/eval";
import * as fs from "fs/promises";
import * as path from "node:path";
import { assert, it } from "@effect/vitest";

const datasetRoot = path.resolve(import.meta.dirname, "../../../.repos/cvdp-benchmark-dataset");
const cvdpSimImage = process.env.OSS_SIM_IMAGE ?? "nvidia/cvdp-sim:v1.0.0";
const StringRecord = Schema.Record(Schema.String, Schema.String);

class CvdpNonAgenticInput extends Schema.Class<CvdpNonAgenticInput>("CvdpNonAgenticInput")({
  prompt: Schema.String,
  context: StringRecord,
}) {}

class CvdpNonAgenticOutput extends Schema.Class<CvdpNonAgenticOutput>("CvdpNonAgenticOutput")({
  response: Schema.String,
  context: StringRecord,
}) {}

class CvdpNonAgenticHarness extends Schema.Class<CvdpNonAgenticHarness>("CvdpNonAgenticHarness")({
  files: StringRecord,
}) {}

class CvdpNonAgenticDatapoint extends Schema.Class<CvdpNonAgenticDatapoint>(
  "CvdpNonAgenticDatapoint",
)({
  id: Schema.String,
  categories: Schema.Array(Schema.String),
  input: CvdpNonAgenticInput,
  output: CvdpNonAgenticOutput,
  harness: CvdpNonAgenticHarness,
}) {}

class CvdpAgenticDatapoint extends Schema.Class<CvdpAgenticDatapoint>("CvdpAgenticDatapoint")({
  id: Schema.String,
  categories: Schema.Array(Schema.String),
  system_message: Schema.String,
  prompt: Schema.String,
  context: StringRecord,
  patch: StringRecord,
  harness: StringRecord,
}) {}

const CvdpDatapoint = Schema.Union([CvdpNonAgenticDatapoint, CvdpAgenticDatapoint]);
type CvdpDatapoint = Schema.Schema.Type<typeof CvdpDatapoint>;

class CvdpCodeResponse extends Schema.Class<CvdpCodeResponse>("CvdpCodeResponse")({
  code: Schema.Array(StringRecord),
}) {}

const decodeCvdpDatapoint = Schema.decodeUnknownSync(CvdpDatapoint);
const isStringRecord = Schema.is(StringRecord);
const isCodeResponse = Schema.is(CvdpCodeResponse);

type CvdpFiles = Readonly<{
  kind: "agentic" | "non-agentic";
  prompt: string;
  context: Readonly<Record<string, string>>;
  output: Readonly<Record<string, string>>;
  harness: Readonly<Record<string, string>>;
  referenceResponse: string;
}>;

class CvdpTask extends Task.Task<
  { simPass: boolean; exitCode: number },
  { category: string; difficulty: string; kind: "agentic" | "non-agentic"; dataset: string }
> {}

type ShellValue = string | number | boolean;
type ShellExpression = ShellValue | ReadonlyArray<ShellValue>;
type SandboxShell = (
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<ShellExpression>
) => Promise<string>;
type SandboxWriteFile = (options: Readonly<{ sandboxPath: string; content: string }>) => Promise<void>;

const isNonAgentic = (datapoint: CvdpDatapoint): datapoint is CvdpNonAgenticDatapoint =>
  "input" in datapoint;

const extractFiles = (datapoint: CvdpDatapoint): CvdpFiles => {
  if (isNonAgentic(datapoint)) {
    return {
      kind: "non-agentic",
      prompt: datapoint.input.prompt,
      context: datapoint.input.context,
      output: datapoint.output.context,
      harness: datapoint.harness.files,
      referenceResponse: datapoint.output.response,
    };
  }

  return {
    kind: "agentic",
    prompt: datapoint.prompt,
    context: datapoint.context,
    output: datapoint.patch,
    harness: datapoint.harness,
    referenceResponse: "",
  };
};

const isSafeRelativePath = (filePath: string): boolean =>
  filePath.length > 0 &&
  !path.posix.isAbsolute(filePath) &&
  filePath.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

const checkedPath = (filePath: string): string => {
  if (!isSafeRelativePath(filePath)) {
    throw new Error(`Unsafe CVDP file path: ${filePath}`);
  }
  return filePath;
};

const makePrompt = (datapoint: CvdpDatapoint): string => {
  const files = extractFiles(datapoint);
  const outputFiles = Object.keys(files.output);
  const context = Object.entries(files.context)
    .map(
      ([file, content]) =>
        `Consider the following content for the file ${file}:\n\`\`\`\n${content}\n\`\`\``,
    )
    .join("\n\n");
  const outputInstruction =
    outputFiles.length === 0
      ? 'Return JSON in the form {"response":"<answer>"} or return the answer as plain text.'
      : outputFiles.length === 1
        ? `Return the complete content for ${outputFiles[0]} as plain text or a single fenced code block.`
        : `Return JSON in the form {"code":[{"<file>":"<content>"}]} using these file names: ${JSON.stringify(outputFiles)}.`;

  return [
    isNonAgentic(datapoint)
      ? "You are solving a CVDP non-agentic hardware verification task."
      : "You are solving a CVDP agentic hardware verification task in a flattened prompt form.",
    isNonAgentic(datapoint) ? "" : datapoint.system_message,
    context,
    `Request:\n${files.prompt}`,
    outputInstruction,
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
};

const textFromPrompt = (prompt: Prompt.Prompt): string =>
  prompt.content
    .flatMap((message) => {
      if (typeof message.content === "string") {
        return [message.content];
      }

      return message.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
    })
    .join("\n");

const extractJsonObject = (text: string): unknown | undefined => {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1] !== undefined) {
    const content = fenced[1].trim();
    if (content.startsWith("{") && content.endsWith("}")) {
      return JSON.parse(content);
    }
  }

  return undefined;
};

const extractCodeObject = (value: unknown): Readonly<Record<string, string>> | undefined => {
  if (isStringRecord(value)) {
    return value;
  }

  if (!isCodeResponse(value)) {
    return undefined;
  }

  const files: Record<string, string> = {};
  for (const item of value.code) {
    for (const [file, content] of Object.entries(item)) {
      files[file] = content;
    }
  }
  return files;
};

const extractSingleFileText = (text: string): string => {
  const fenced = /```(?:[A-Za-z0-9_+.-]+)?\s*([\s\S]*?)```/.exec(text);
  return fenced?.[1]?.trim() ?? text.trim();
};

const parseModelFiles = (
  trajectory: Prompt.Prompt,
  expectedFiles: ReadonlyArray<string>,
): Readonly<Record<string, string>> => {
  const text = textFromPrompt(trajectory);
  try {
    const files = extractCodeObject(extractJsonObject(text));
    if (files !== undefined) {
      return Object.fromEntries(
        Object.entries(files).filter(([file]) => expectedFiles.includes(file)),
      );
    }
  } catch {
    // Fall through to plain-text extraction.
  }

  if (expectedFiles.length === 1 && expectedFiles[0] !== undefined) {
    return { [expectedFiles[0]]: extractSingleFileText(text) };
  }

  return {};
};

const writeFiles = async ({
  $,
  writeFile,
  root,
  files,
}: {
  $: SandboxShell;
  writeFile: SandboxWriteFile;
  root: "/code";
  files: Readonly<Record<string, string>>;
}) => {
  for (const [file, content] of Object.entries(files)) {
    const sandboxPath = path.posix.join(root, checkedPath(file));
    await $`mkdir -p ${path.posix.dirname(sandboxPath)}`;
    await writeFile({ sandboxPath, content });
  }
};

const runHarness = async ({
  $,
}: {
  $: SandboxShell;
}): Promise<{ simPass: boolean; exitCode: number }> => {
  const output = await $`
    exec 2>&1
    rm -rf /src
    mkdir -p /src /code/rundir
    if [ -d /code/src ]; then cp -a /code/src/. /src/; fi
    cd /code/rundir
    python3 - <<'PY'
import os
import subprocess

env_path = "/src/.env"
if os.path.exists(env_path):
    with open(env_path, encoding="utf-8") as env_file:
        for line in env_file:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ[key.strip()] = value.strip()

os.environ.setdefault("PYTHONPATH", "/src")
command = ["pytest", "-s", "-o", "cache_dir=/code/rundir/.cache", "/src/test_runner.py", "-s"]
raise SystemExit(subprocess.call(command))
PY
    status=$?
    echo "__CVDP_EXIT_CODE__=$status"
    exit 0
  `;
  const marker = /__CVDP_EXIT_CODE__=(\d+)/.exec(output);
  const exitCode = marker?.[1] === undefined ? 1 : Number(marker[1]);
  return { simPass: exitCode === 0, exitCode };
};

async function* load(dataset: string): AsyncIterable<CvdpTask> {
  const filePath = path.join(datasetRoot, dataset);
  const content = await fs.readFile(filePath, "utf8");
  const datapoints = content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => decodeCvdpDatapoint(JSON.parse(line)));
  const snapshot = Snapshot.make({ image: cvdpSimImage });

  for (const datapoint of datapoints) {
    const files = extractFiles(datapoint);
    const outputFiles = Object.keys(files.output).filter(isSafeRelativePath);

    yield new CvdpTask({
      name: datapoint.id,
      prompt: [Prompt.userMessage({ content: [Prompt.textPart({ text: makePrompt(datapoint) })] })],
      grader: async ({ trajectory, writeFile, $ }) => {
        await $`rm -rf /code /src && mkdir -p /code/docs /code/rtl /code/verif /code/src /code/rundir`;
        await writeFiles({ $, writeFile, root: "/code", files: files.context });
        await writeFiles({ $, writeFile, root: "/code", files: files.harness });
        await writeFiles({
          $,
          writeFile,
          root: "/code",
          files: parseModelFiles(trajectory, outputFiles),
        });
        return runHarness({ $ });
      },
      verifier:
        Object.values(files.output).some((value) => value.trim().length > 0) &&
        Object.keys(files.harness).length > 0
          ? {
              exec: async ({ writeFile, $ }) => {
                await $`rm -rf /code /src && mkdir -p /code/docs /code/rtl /code/verif /code/src /code/rundir`;
                await writeFiles({ $, writeFile, root: "/code", files: files.context });
                await writeFiles({ $, writeFile, root: "/code", files: files.harness });
                await writeFiles({ $, writeFile, root: "/code", files: files.output });
                return Prompt.empty;
              },
              expect: { simPass: true, exitCode: 0 },
            }
          : undefined,
      snapshot,
      extra: {
        category: datapoint.categories[0] ?? "unknown",
        difficulty: datapoint.categories[1] ?? "unknown",
        kind: files.kind,
        dataset,
      },
    });
  }
}

it("cvdp non-agentic code generation dataset should load", async () => {
  const tasks = await Effect.runPromise(
    Task.fromAsyncIter(load("cvdp_v1.1.0_nonagentic_code_generation_no_commercial.jsonl")),
  );

  assert.lengthOf(tasks, 302);
  const firstTask = tasks[0];
  assert.isDefined(firstTask);
  if (firstTask === undefined) {
    return;
  }

  const first = await Effect.runPromise(firstTask.pipe(Effect.scoped));
  assert.strictEqual(first.name, "cvdp_copilot_16qam_mapper_0001");
  assert.strictEqual(first.extra?.kind, "non-agentic");
  assert.strictEqual(first.extra?.category, "cid003");
  assert.isUndefined(first.verifier);
});

it("cvdp agentic code generation dataset should load", async () => {
  const tasks = await Effect.runPromise(
    Task.fromAsyncIter(load("cvdp_v1.1.0_agentic_code_generation_no_commercial.jsonl")),
  );

  assert.lengthOf(tasks, 92);
  const firstTask = tasks[0];
  assert.isDefined(firstTask);
  if (firstTask === undefined) {
    return;
  }

  const first = await Effect.runPromise(firstTask.pipe(Effect.scoped));
  assert.strictEqual(first.name, "cvdp_agentic_64b66b_codec_0001");
  assert.strictEqual(first.extra?.kind, "agentic");
  assert.strictEqual(first.extra?.category, "cid005");
  assert.isUndefined(first.verifier);
});
