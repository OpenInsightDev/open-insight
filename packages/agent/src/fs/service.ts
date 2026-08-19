import { Context, Effect, Schema } from "effect";

// export type ReadFileOptions = Readonly<{
//   startLine?: number;
//   endLine?: number;
//   maxBytes?: number;
// }>;

export const ReadFileOptions = Schema.Struct({
  filePath: Schema.String,
});

export class Fs extends Context.Service<
  Fs,
  {
    readFile: (filePath: string, options?: ReadFileOptions) => Effect.Effect<string>;
  }
>()("Fs") {}
