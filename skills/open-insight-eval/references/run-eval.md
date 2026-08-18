# Running Evaluation

Evaluation prepares each task snapshot before starting that task's trails.
`snapshotConcurrency` limits snapshot preparation, `trailConcurrency` limits
running trails, and `trailCount` selects how many trails each task runs.

`Eval.run(bench, options)` and `Eval.make(options)(bench)` produce the same
event stream. Pipe it through `Eval.result` to consume the stream and obtain the
final `BenchResult`:

```ts
const result = yield* Eval.run(bench).pipe(Eval.result)
```

`Eval.result` preserves evaluation failures and converts the stream's final
internal `ResultDone<BenchResult>` signal into the returned result. Use
`Eval.stream` when only the event sequence is needed:

```ts
import { Stream } from "effect"

const events = yield* Eval.run(bench).pipe(Eval.stream, Stream.runCollect)
```
