# VerilogEval real-API failure investigation

Status: investigated, not fixed  
Date: 2026-07-29

## Summary

The real-API VerilogEval integration completed its evaluation lifecycle, but all 10 sampled tasks received `simPass: false`. Eight of the 10 trails also reported a failed tool call.

This is not primarily evidence that the model cannot solve the benchmark. The investigation found three independent integration problems before RTL quality can be measured reliably:

1. The task never tells the agent that the required artifact is `/workspace/top.v`.
2. The configured agent performs one model request per static stage prompt and does not continue after receiving a tool result.
3. Sandbox failures are converted to an empty string, hiding the error from both the model and test output.

The verifier control run passed all 10 tasks with the same grader and testbenches. This rules out a general failure in the iverilog grader, mismatch regex, or dataset testbench setup.

No fix is included in this document.

## Observed run

Configuration:

- Test: `packages/eval/tests/verilog-eval.test.ts`
- Model: `deepseek-v4-flash`
- API: OpenAI-compatible chat completions
- Mode: `verifMode: false`
- Tasks: 10
- Trails per task: 1
- Sandbox: Docker, snapshot workdir `/workspace`

Observed result:

| Observation | Value |
| --- | ---: |
| Completed task results | 10 |
| Simulation passes | 0 |
| Tool calls | 10 |
| Failed tool calls | 8 |
| `TrailStagedEvent` | 10 |
| `TrajMetricEvent` | 20 |
| `TrailStreamEvent` | 18,096 |

The evaluation and event transport completed normally. Model failure is represented as a valid grade rather than an evaluation exception.

## Evidence

### 1. The delivery path is unspecified

The dataset prompt describes only the module interface and behavior. For example, `Prob009_popcount3` asks for a module named `TopModule`, but does not specify a filename or output directory.

The grader has a stricter implicit contract:

```text
cp top.v /tmp/verilog-eval/top.v
```

Because the snapshot workdir is `/workspace`, the grader therefore requires:

```text
/workspace/top.v
```

Neither the prompt nor the base agent system instructions expose that requirement. `SandboxWriteFile` also accepts any `sandboxPath`; its description does not identify `/workspace` as the workdir or `top.v` as the required artifact.

In a captured `Prob009_popcount3` run, the model produced functionally plausible RTL but called:

```json
{
  "name": "SandboxWriteFile",
  "params": {
    "sandboxPath": "/home/user/TopModule.v",
    "content": "module TopModule (...) ... endmodule"
  }
}
```

The write failed because `/home/user` is not a valid destination in this sandbox. Even if it had succeeded, the grader would still not find `/workspace/top.v`.

### 2. The agent does not continue after tools

The evaluation prompt loop and chat loop have different responsibilities:

1. `Task.makePromptFn` turns a static stage prompt into a function that returns the prompt once and then returns `null`.
2. `runPromptFn` invokes `promptSession` for that one prompt.
3. `Chat.streamText` performs one language-model request, resolves tool calls, records the response and tool results in chat history, and finishes the stream.
4. The stage prompt function then returns `null`, so evaluation proceeds directly to grading.

There is no model continuation after a tool result.

This is visible in a captured `Prob113_2012_q1g` run. The model's only action was to write an intermediate analysis script:

```json
{
  "name": "SandboxWriteFile",
  "params": {
    "sandboxPath": "/home/user/analyze.py",
    "content": "# Analyze the K-map ..."
  }
}
```

After the tool result, the model was not called again. It never executed the analysis and never produced `top.v`; the grader ran immediately and returned `simPass: false`.

This behavior makes multi-step tool use impossible for a static task prompt. It also makes a recoverable tool error terminal from the model's perspective.

### 3. Sandbox errors become empty tool results

The sandbox toolkit maps failures with:

```text
Effect.mapError((error) => error.message)
```

The captured failed tool results contained:

```json
{
  "name": "SandboxWriteFile",
  "isFailure": true,
  "result": "",
  "encodedResult": ""
}
```

The underlying sandbox error is a schema-backed `Sandbox.Error`. Its useful data is nested under `reason`, including the operation and original cause. Mapping only `.message` discards that structured information and, in these runs, produces an empty string.

Consequences:

- The model cannot learn that the destination directory does not exist.
- A future iterative loop would still be unable to self-correct from this result.
- Event logs show that a tool failed but not why it failed.
- The observed tool success-rate metric is accurate but not diagnostically useful.

### 4. Model behavior amplifies the integration defects

The model frequently chooses conventional paths such as `/home/user/...` because no sandbox path contract is supplied. On the K-map task it also spent 18,397 output tokens constructing an analysis artifact instead of producing the requested RTL.

This behavior may indicate model-specific tool-use quality or stopping problems, but it is not currently possible to measure those cleanly. The path contract, iteration loop, and error propagation must be corrected before comparing models or treating the 0/10 score as a model benchmark result.

## Control result: the grader works

With `verifMode: true`, each task's verifier writes the reference implementation to `top.v` and runs the same grader. The 10-task control run completed with all grades equal to `{ simPass: true }`.

This validates the following components for the sampled tasks:

- Docker snapshot and iverilog installation
- reference and testbench upload paths
- `top.v`, `ref.sv`, and `test.sv` compilation command
- `vvp` execution
- `Mismatches: 0 in N samples` parsing
- grade schema and event publication

The real-API failure occurs before or at agent artifact production, not in the general grader path.

## Root-cause chain

The dominant failure path is:

```text
Prompt omits artifact path
  -> model chooses /home/user/... or an intermediate artifact
  -> sandbox write fails or grader cannot see the file
  -> tool error is encoded as an empty string
  -> no second model turn occurs
  -> /workspace/top.v is absent or invalid
  -> grader returns simPass: false
```

The two observed successful tool calls in one 10-task run do not invalidate this chain. Tool success only means the handler accepted the requested operation; it does not prove that the model wrote `/workspace/top.v` or that the RTL was correct. Their exact artifacts were not retained, so their simulation failures remain a separate item to reproduce after the integration contract is fixed.

## Recommended repair order

These are recommendations only; they are not implemented here.

1. Make the artifact contract explicit.
   State that the final answer must be a complete `TopModule` saved as `/workspace/top.v`. Decide whether this belongs in the benchmark prompt, generic sandbox instructions, or both.

2. Add a bounded agent continuation policy.
   Continue model turns after tool results until the model stops requesting tools or a configured turn/tool limit is reached. Preserve the existing task-level follow-up prompt mechanism as a separate concept.

3. Preserve structured tool failures.
   Return a stable, non-empty failure payload containing at least the sandbox operation and cause. Do not reduce schema-backed errors to `.message` without verifying that it is meaningful.

4. Add focused regression tests.
   Cover a wrong write path, a failed tool followed by model correction, an intermediate analysis step followed by final artifact creation, and successful creation of `/workspace/top.v`.

5. Re-run the benchmark and only then evaluate model quality.
   Record per-task artifact path, compile stderr, mismatch output, tool failures, and token usage. Investigate remaining `simPass: false` results as RTL-quality failures.

## Acceptance criteria for a future fix

- The agent is explicitly aware that `/workspace/top.v` is the required artifact.
- A failed tool call returns a non-empty actionable error.
- The model receives tool results and can perform a subsequent turn.
- Agent iteration has deterministic limits and a clear terminal reason.
- A simple task such as `Prob009_popcount3` can write the shown valid RTL to the required path and pass simulation.
- Verifier mode remains 10/10 for the sampled tasks.
- Real-API event streams retain tool-call, tool-result, finish, grade, and usage observability.

## Deferred issue

Stage identifiers and staged-event identifiers are a separate schema concern and are intentionally not addressed by this investigation.
