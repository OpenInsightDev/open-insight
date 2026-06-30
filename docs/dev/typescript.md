# Docs about Any TypeScript issues

## `This is likely not portable` issue

pnpm workspace has a [long-standing issue](https://github.com/microsoft/TypeScript/issues/42873#issuecomment-2066874644) of `This is likely not portable` error.
This issue blocks the `vp pack`.
As a workaround, we import the `@open-insight/core` types like this:

```ts
import type * as _Core from "@open-insight/core";
```

The imported `_Core` is not used, but it indeed solves the issue.
