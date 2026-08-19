import { Context, Effect, Path, Schema, SchemaGetter } from "effect";

// export type ReadFileOptions = Readonly<{
//   startLine?: number;
//   endLine?: number;
//   maxBytes?: number;
// }>;

const validateAbsPath = Effect.fn("AbsPath.validate")(function* (value: string) {
  const path = yield* Path.Path;
  return path.isAbsolute(value) || "must be a Unix absolute path";
});

export const AbsPath = Schema.String.pipe(
  Schema.decode({
    decode: SchemaGetter.checkEffect(validateAbsPath),
    encode: SchemaGetter.passthrough(),
  }),
  Schema.brand("AbsPath"),
);
export type AbsPath = typeof AbsPath.Type;

export const ReadFileOptions = Schema.Struct({
  filePath: Schema.String,
});
export type ReadFileOptions = typeof ReadFileOptions.Type;

export class Fs extends Context.Service<
  Fs,
  {
    readFile: (filePath: string, options?: ReadFileOptions) => Effect.Effect<string>;
  }
>()("Fs") {}
