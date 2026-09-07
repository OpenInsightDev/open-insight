import { NodeServices } from "@effect/platform-node";
import { FileSystem, Layer, Terminal } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
NodeServices.layer;

export type SandboxLayer = Layer.Layer<
  FileSystem.FileSystem | Terminal.Terminal | ChildProcessSpawner.ChildProcessSpawner
>;
