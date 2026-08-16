# Running Evaluation

Evaluation prepares snapshots before it starts any trails. Task snapshots are
grouped by their computed snapshot handle, so tasks that share a snapshot build
it once per evaluation. `snapshotConcurrency` limits unique snapshot
preparation, `taskConcurrency` limits task runner creation, and
`trailConcurrency` limits running trails.

Log output is controlled by the `console` and `logLevel` config options; see
`logging.md` for details.

`Eval.make(options)(bench)` produces an event stream. Pipe that stream through
`Eval.run` to consume its events and obtain the final `BenchResult`:

```ts
const result = yield* Eval.make()(bench).pipe(Eval.run)
```

`Eval.run` preserves evaluation failures and only converts the stream's final
`Cause.Done<BenchResult>` signal into the returned result.
