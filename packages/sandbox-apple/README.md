# @open-insight/sandbox-apple

Apple Container CLI sandbox provider for Open Insight. It requires macOS with the `container` CLI installed and its service running.

```ts
import { make } from "@open-insight/sandbox-apple";

const providerEffect = make({
  portMappings: [{ sandboxPort: 8080, hostPort: 18080 }],
});
```

`hostPort` is required because Apple Container does not support dynamic host port publication. CPU, memory, port publication, isolated networking, command execution, and file transfer are mapped to native `container` CLI commands.
Apple Container requires a memory limit of at least 200 MiB; lower requests fail before a sandbox is created.

## Development

- Install dependencies:

```bash
vp install
```

- Run the unit tests:

```bash
vp test
```

- Build the library:

```bash
vp pack
```
