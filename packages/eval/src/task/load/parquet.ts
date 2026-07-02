import { Schema } from "effect";

export const withParquet = <T>({
  filePath,
  schema,
}: {
  filePath: string;
  schema: Schema.Schema<T>;
}) => {};

export const withParquetDir = <T>({
  dirPath,
  prefix,
  schema,
}: {
  dirPath: string;
  prefix: string;
  schema: Schema.Schema<T>;
}) => {};
