# CVDP benchmark: upstream evaluation issue log

This file records upstream `@open-insight/eval`-related issues observed while
running `cvdp.ts`. The vendored source under `references/open-insight` is used
only for diagnosis. It is not modified here because changing that checkout
does not provide a hot fix for the installed package.

## Snapshot cache build race

Status: worked around in `cvdp.ts`; upstream fix still needed.

Observed on 2026-08-05 while running:

```text
deno run --env-file -A cvdp.ts
```

The benchmark loaded two tasks which use the same `Snapshot.makeWith` image.
With the default `Eval` configuration, both task preparations emitted a build
request for the exact same Docker tag:

```text
open-insight-snapshot:0a173ba9ae00cbfcb03f75d1f4ec30f46e3ef2e68a8e9f851d51bd864eeb36c9
```

Two `docker build` processes were then observed for that tag at the same time.
After more than five minutes neither process had produced the image or
completed a task, and both processes were idle. The run was terminated after
the duplicate build remained stuck.

The first workaround attempt set `snapshotConcurrency: 1`, but a second run
still emitted two builds immediately. This is important evidence that the
configuration name does not protect the actual Docker snapshot acquisition
path.

### Source path to the issue

In the vendored `@open-insight/eval` source:

- `packages/eval/src/eval/config.ts` sets `snapshotConcurrency` to `32` by
  default.
- `packages/eval/src/eval/schedule.ts` prepares all tasks with
  `Effect.all(tasks.map(prepareTask), { concurrency: snapshotConcurrency })`,
  but `prepareTask` only creates a trail runner.
- `packages/eval/src/eval/trail.ts` calls `harnessService.run(snapshot, ...)`
  inside the actual trail runner.
- `packages/eval/src/eval/schedule.ts` executes those trail runners with
  `Stream.mapEffect(..., { concurrency: trailConcurrency })`.
- Therefore the Docker snapshot acquisition is controlled by
  `trailConcurrency`, not by the documented `snapshotConcurrency` setting.

In the vendored Docker provider:

- `packages/core/src/sandbox/builtin/docker/index.ts` checks
  `imageExists(handle)` and then independently invokes `docker build` when the
  image is absent.
- There is no per-image lock or in-flight build deduplication between those
  two operations.

The combination means that two tasks sharing an uncached snapshot can both
observe a cache miss and build the same image concurrently. This is an
evaluation scheduling/provider coordination bug, rather than a CVDP task or
grader failure.

### Workaround and expected upstream fix

`cvdp.ts` sets both `snapshotConcurrency: 1` and `trailConcurrency: 1`.
The latter serializes the actual snapshot acquisition while leaving
`trailCount: 1` as requested. A proper upstream fix should either make
`snapshotConcurrency` cover snapshot acquisition, or coordinate concurrent
acquisition of the same snapshot by deduplicating in-flight builds by snapshot
handle or locking the cache-miss/build sequence.

### Verification after workaround

The workaround is considered valid only when a subsequent full CVDP run shows
one build for the shared snapshot followed by both task trails reaching a
terminal grade. This was verified on 2026-08-05: the final real-agent run
performed one snapshot build, reached terminal grades for both trails, and
exited successfully. A separate golden-verifier run also reached `pass=2/2`.

## Verifier executes multiple times in one stage

Status: worked around in `benchmarks/cvdp_benchmark/mod.ts`; upstream fix still
needed.

Observed on 2026-08-06 while running the commercial agentic golden task:

```text
CVDP_VERIF=1 \
CVDP_DATASET=benchmarks/cvdp_benchmark/example_dataset/cvdp_v1.1.0_example_agentic_code_generation_commercial_with_solutions.jsonl \
deno run --env-file -A cvdp.ts
```

The task verifier applies the supplied golden patch to the existing file
`rtl/priority_encoder.sv`. The first application succeeds when reproduced
directly with `git apply --check`, but the eval run invokes the same verifier
again against the already-patched sandbox. The second application fails with:

```text
error: patch failed: rtl/priority_encoder.sv:3
error: rtl/priority_encoder.sv: patch does not apply
CVDP_GIT_APPLY_EXIT=1
```

This is observable for an existing-file patch. A new-file patch can exhibit
the same repeated side effect, although removing the generated path before
each application happened to mask it in the earlier no-commercial task.

### Source path to the issue

In `references/open-insight/packages/eval/src/eval/trail.ts`:

- Lines 19-31 implement `makeVerifAgent`. Its `trajectory` field is a cold
  `Effect.tryPromise(() => verifier(...))`; the effect is not memoized.
- Lines 122-124 implement `getTrajectory` by reading the current session and
  evaluating `session.trajectory`.
- `runPromptFn` reads the trajectory at lines 185-186.
- `promptSession` reads it again as `prevTrajectory` at lines 129-131.
- In verification mode, lines 275-276 install the verifier-backed session,
  then line 289 enters this prompt path.

Consequently, a single verifier stage evaluates `VerifExec` at least twice.
`VerifExec` receives the mutable sandbox API and is expected to prepare the
golden solution, so repeated evaluation is not semantically harmless. The
failure is reported through nested agent/harness trajectory errors, which
also obscures that the failing operation is verifier setup rather than an
agent trajectory.

### Workaround and expected upstream fix

The CVDP verifier restores every patched path to its task baseline before
applying the golden patch. Existing paths are rewritten from `task.context`;
new paths are removed. This makes repeated verifier evaluation idempotent
without modifying the installed `@open-insight/eval` package.

Upstream should execute `VerifExec` exactly once per stage and memoize the
resulting trajectory, or otherwise make the verifier session's trajectory a
stable value. Requiring every benchmark verifier to anticipate repeated
mutation is error-prone and is not apparent from the `VerifExec` API.
