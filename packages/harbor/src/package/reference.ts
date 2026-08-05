import { Effect, pipe, Schema } from "effect";
import { PackageName } from "./schema.ts";
import { parseVersionRef, VersionRef } from "./version-ref.ts";

const withDefault = <S extends Schema.Constraint & Schema.WithoutConstructorDefault>(
  schema: S,
  value: () => Schema.Schema.Type<S>,
) =>
  pipe(
    schema,
    Schema.withConstructorDefault(Effect.sync(value)),
    Schema.withDecodingDefaultTypeKey(Effect.sync(value)),
  );

const defaultPackageRef = "latest";

export class PackageReference extends Schema.Class<PackageReference>("PackageReference")({
  name: PackageName,
  ref: withDefault(Schema.String, () => defaultPackageRef),
}) {
  static parse(refString: string): PackageReference {
    const separator = refString.lastIndexOf("@");
    return separator === -1
      ? PackageReference.make({ name: refString })
      : PackageReference.make({
          name: refString.slice(0, separator),
          ref: refString.slice(separator + 1),
        });
  }

  get parsed_ref(): VersionRef {
    return parseVersionRef(this.ref);
  }

  get org(): string {
    return this.name.split("/")[0];
  }

  get short_name(): string {
    return this.name.split("/")[1];
  }
}
