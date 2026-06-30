import { Schema } from "effect";
import { Instructions } from "./instruction.ts";

/**
 * OCI image reference (e.g. `docker.io/library/node:18-alpine`).
 */
export const Image = Schema.String;
export type Image = Schema.Schema.Type<typeof Image>;

export class Snapshot extends Schema.Class<Snapshot>("Snapshot")({
  image: Image,
  instructions: Instructions,
}) {}

/**
 * The name of the snapshot.
 *
 * Each snapshot must use this name and mapped to different hash tags.
 */
export const SNAPSHOT_NAME = "open-insight-snapshot";

export const make: typeof Snapshot.make = (args) => Snapshot.make(args);
