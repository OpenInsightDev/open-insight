import { Context, Effect } from "effect";

export type ReadFileOptions = Readonly<{
  startLine?: number;
  endLine?: number;
  maxBytes?: number;
}>;

export class Fs extends Context.Service<
  Fs,
  {
    readFile: (filePath: string, options?: ReadFileOptions) => Effect.Effect<string>;
  }
>()("Fs") {}
