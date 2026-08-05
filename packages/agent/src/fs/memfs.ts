/**
 * In-memory file system service backed by `memfs`.
 *
 * `MemFs` holds a `memfs` instance: `fs` is a drop-in replacement for
 * `node:fs`, and `vol` is the underlying `Volume` that can be used to seed and
 * inspect the file system.
 *
 * The layers build a **fresh, isolated volume per build**, so every
 * `Effect.provide` boundary gets its own file system. Combine with
 * `Effect.scoped` to tie the volume's lifetime to a scope.
 */
import { Context, Effect, Layer } from "effect";
import { memfs, type IFs, type MemfsOptions, type NestedDirectoryJSON, type Volume } from "memfs";

export type Fs = Readonly<{
  /** The `memfs` instance, a drop-in replacement for `node:fs`. */
  readonly fs: IFs;
  /** The underlying volume, useful for seeding and inspecting the file system. */
  readonly vol: Volume;
}>;

/**
 * Creates a new `memfs` instance, optionally seeded with a JSON directory
 * structure.
 */
export const make = (json?: NestedDirectoryJSON, options?: MemfsOptions): Fs =>
  memfs(json, options);

export class MemFs extends Context.Service<MemFs, Fs>()("agent/MemFs") {
  /**
   * Provides `MemFs` backed by a fresh, empty in-memory volume.
   */
  static readonly layer: Layer.Layer<MemFs> = Layer.fresh(
    Layer.effect(MemFs)(Effect.sync(() => memfs())),
  );

  /**
   * Provides `MemFs` backed by a fresh in-memory volume seeded with a JSON
   * directory structure.
   *
   * @example
   * MemFs.layerWith({
   *   "/workspace": {
   *     "README.md": "# hello",
   *     "src": { "index.ts": "" },
   *   },
   * })
   */
  static readonly layerWith = (
    json?: NestedDirectoryJSON,
    options?: MemfsOptions,
  ): Layer.Layer<MemFs> =>
    Layer.fresh(Layer.effect(MemFs)(Effect.sync(() => memfs(json, options))));
}
