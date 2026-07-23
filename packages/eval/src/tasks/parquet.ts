import { Effect, Schema } from "effect";
import * as Task from "#/task/index.ts";
import type { Load } from "./index.ts";

export const withParquetDir = <S>({
  dirPath: _dirPath,
  prefix: _prefix,
  schema: _schema,
}: {
  dirPath: string;
  prefix: string;
  schema: Schema.Schema<S>;
}) =>
  Effect.fn(function* <T extends Task.Task>(
    _exec: ({ items }: { items: AsyncIterator<S> }) => Load<T>,
  ) {});
