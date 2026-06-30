# Docs about Deno

## Why don't we use Deno anymore

This project is heavily based on Effect, which includes a lot of complex TypeScript types.
Deno 2.8 introduced [`deno pack`](https://docs.deno.com/runtime/reference/cli/pack/), which can package deno project into a npm-compatible package.
However, `deno pack` requires:

1. every public exported consts to be explicitly typed
2. class cannot have complex base class

otherwise it will report an error of [slow-type](https://jsr.io/docs/about-slow-types) and fail to generate dts file.

Use `--allow-slow-types` can bypass the error, but it will [generate `any` type for complex types](https://github.com/denoland/deno/issues/31290), which is not acceptable.
