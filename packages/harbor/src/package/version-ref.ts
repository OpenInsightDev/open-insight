import { Schema } from "effect";

export const RefType = Schema.Literals(["tag", "revision", "digest"]);
export type RefType = Schema.Schema.Type<typeof RefType>;

const TagPattern = /^[a-z0-9][a-z0-9.-]*$/;

export class VersionRef extends Schema.Class<VersionRef>("VersionRef")({
  type: RefType,
  value: Schema.String,
}) {
  static parse(ref: string | null | undefined): VersionRef {
    return parseVersionRef(ref);
  }

  get revision(): number {
    if (this.type !== "revision") {
      throw new Error(`Cannot get revision from ${this.type} ref`);
    }
    return Number(this.value);
  }
}

export function parseVersionRef(ref: string | null | undefined): VersionRef {
  if (ref === null || ref === undefined || ref === "" || ref === "latest") {
    return VersionRef.make({ type: "tag", value: "latest" });
  }
  if (/^\d+$/.test(ref)) {
    return VersionRef.make({ type: "revision", value: ref });
  }
  if (ref.startsWith("sha256:")) {
    return VersionRef.make({ type: "digest", value: ref });
  }
  return VersionRef.make({ type: "tag", value: ref });
}

export function validateTag(tag: string): string {
  if (!tag) {
    throw new Error("Tag name cannot be empty");
  }
  if (/^\d+$/.test(tag)) {
    throw new Error(`Tag name cannot be a pure integer: ${tag}`);
  }
  if (tag.startsWith("sha256:")) {
    throw new Error(`Tag name cannot start with sha256:: ${tag}`);
  }
  if (!TagPattern.test(tag)) {
    throw new Error(`Tag name must be lowercase alphanumeric with hyphens and dots only: ${tag}`);
  }
  return tag;
}
