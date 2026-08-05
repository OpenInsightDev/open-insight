# Running Evaluation

Evaluation prepares snapshots before it starts any trails. Task snapshots are
grouped by their computed snapshot handle, so tasks that share a snapshot build
it once per evaluation. `snapshotConcurrency` limits unique snapshot
preparation, `taskConcurrency` limits task runner creation, and
`trailConcurrency` limits running trails.
