import { Formatter, Schema } from "effect";

/** The plugin root is not an existing directory. */
export class RootInvalid extends Schema.TaggedErrorClass<RootInvalid>(
  "open-insight/PluginError/RootInvalid",
)("RootInvalid", {
  root: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Plugin root is not a directory: ${this.root} (${Formatter.format(this.cause)})`;
  }
}

/** `plugin.json` is absent at the plugin root. */
export class ManifestMissing extends Schema.TaggedErrorClass<ManifestMissing>(
  "open-insight/PluginError/ManifestMissing",
)("ManifestMissing", {
  root: Schema.String,
}) {
  override get message(): string {
    return `Plugin root has no plugin.json manifest: ${this.root}`;
  }
}

/** `plugin.json` is unreadable, invalid JSON, or violates the manifest schema. */
export class ManifestInvalid extends Schema.TaggedErrorClass<ManifestInvalid>(
  "open-insight/PluginError/ManifestInvalid",
)("ManifestInvalid", {
  root: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Invalid plugin.json manifest at ${this.root}: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([RootInvalid, ManifestMissing, ManifestInvalid]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/**
 * A fatal failure while loading a plugin.
 *
 * Only manifest-level failures are fatal (§5): a missing or invalid root
 * directory or manifest rejects the plugin. Component-level failures are
 * isolated and never surface through this error (§6.2, §7.2.2, §11.3).
 */
export class PluginError extends Schema.TaggedErrorClass<PluginError>("open-insight/PluginError")(
  "PluginError",
  {
    reason: ErrorReason,
  },
) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static rootInvalid = (root: string, cause: unknown): PluginError =>
    PluginError.make({ reason: RootInvalid.make({ root, cause }) });

  static manifestMissing = (root: string): PluginError =>
    PluginError.make({ reason: ManifestMissing.make({ root }) });

  static manifestInvalid = (root: string, cause: unknown): PluginError =>
    PluginError.make({ reason: ManifestInvalid.make({ root, cause }) });
}
