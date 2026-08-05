import { Effect, pipe, Schema } from "effect";
import { Author } from "../common/config.ts";
import {
  FileDigest,
  NonEmptyVersion,
  PackageName,
  Sha256Digest,
  SimpleFilename,
} from "../package/schema.ts";
import { PackageReference } from "../package/reference.ts";

const withDefault = <S extends Schema.Constraint & Schema.WithoutConstructorDefault>(
  schema: S,
  value: () => Schema.Schema.Type<S>,
) =>
  pipe(
    schema,
    Schema.withConstructorDefault(Effect.sync(value)),
    Schema.withDecodingDefaultTypeKey(Effect.sync(value)),
  );

const defaultManifestVersion = "1.0";

export class DatasetTaskRef extends Schema.Class<DatasetTaskRef>("DatasetTaskRef")({
  name: PackageName,
  digest: Sha256Digest,
}) {
  toPackageReference(): PackageReference {
    return PackageReference.make({ name: this.name, ref: this.digest });
  }

  get org(): string {
    return this.name.split("/")[0];
  }

  get short_name(): string {
    return this.name.split("/")[1];
  }
}

export class DatasetFileRef extends Schema.Class<DatasetFileRef>("DatasetFileRef")({
  path: SimpleFilename,
  digest: withDefault(FileDigest, () => ""),
}) {}

export class DatasetInfo extends Schema.Class<DatasetInfo>("DatasetInfo")({
  name: PackageName,
  version: Schema.optionalKey(Schema.NullOr(NonEmptyVersion)),
  description: withDefault(Schema.String, () => ""),
  authors: withDefault(Schema.Array(Author), () => new Array<Author>()),
  keywords: withDefault(Schema.Array(Schema.String), () => new Array<string>()),
}) {
  get org(): string {
    return this.name.split("/")[0];
  }

  get short_name(): string {
    return this.name.split("/")[1];
  }
}

export class DatasetManifest extends Schema.Class<DatasetManifest>("DatasetManifest")({
  schema_version: withDefault(Schema.String, () => defaultManifestVersion),
  dataset: DatasetInfo,
  tasks: withDefault(Schema.Array(DatasetTaskRef), () => new Array<DatasetTaskRef>()),
  files: withDefault(Schema.Array(DatasetFileRef), () => new Array<DatasetFileRef>()),
}) {}
