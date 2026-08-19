# Provide Tasks Through a Service

When a benchmark or another evaluation component needs a task constructor, provide its lazy loader with `Tasks.Service`:

```ts
import { Tasks } from "@open-insight/eval";

const tasksLayer = Tasks.Service.layerFrom(Tasks.fromDir({ dir: "./tasks" }));
```

`Tasks.Service.layerFrom` executes the `Tasks.Load` Effect while building the layer and provides the resulting `Tasks.Tasks` value to dependent effects. Keep source acquisition and task construction in the existing `Tasks` loaders, then provide the loader at the application boundary.

## Load from Git safely

`Tasks.withGitRepo`, `Tasks.withGithub`, and `Tasks.withHuggingface` clone into a managed cache directory by default. Managed cache directories may be reset, cleaned, or replaced when their repository state does not match the requested source.

An explicit `directory` is caller-owned. The Git loader reuses it only when it is already a clean matching repository, or clones into it when it is empty. It returns `TasksError` with a `DirectoryConflict` reason instead of resetting, cleaning, or deleting a non-empty explicit directory that does not match. Use a dedicated empty directory rather than a workspace or another directory containing user files.
