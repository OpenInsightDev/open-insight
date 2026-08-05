import { Schema } from "effect";

const PackageNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export const PackageName = Schema.String.check(
  Schema.makeFilter((input) =>
    PackageNamePattern.test(input) && !input.includes("..")
      ? undefined
      : "name must use org/name format without path traversal",
  ),
);

export const Sha256Digest = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/));

export const FileDigest = Schema.Union([Schema.Literal(""), Sha256Digest]);

export const NonEmptyVersion = Schema.String.check(Schema.isMinLength(1));

export const SimpleFilename = Schema.String.check(
  Schema.makeFilter((input) =>
    input.includes("/") || input.includes("\\")
      ? "path must be a filename without directory separators"
      : undefined,
  ),
);
