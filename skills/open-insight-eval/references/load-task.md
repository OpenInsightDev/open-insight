# Provide Tasks Through a Service

When a benchmark or another evaluation component needs a task constructor, provide its lazy loader with `Tasks.Service`:

```ts
import { Tasks } from "@open-insight/eval";

const tasksLayer = Tasks.Service.layerFrom(Tasks.fromDir({ dir: "./tasks" }));
```

`Tasks.Service.layerFrom` executes the `Tasks.Load` Effect while building the layer and provides the resulting `Tasks.Tasks` value to dependent effects. Keep source acquisition and task construction in the existing `Tasks` loaders, then provide the loader at the application boundary.
