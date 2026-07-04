import { Schema } from "effect";
import { Instructions } from "./inst.ts";

/**
 * OCI image reference (e.g. `docker.io/library/node:18-alpine`).
 */
export const Image = Schema.String;
export type Image = Schema.Schema.Type<typeof Image>;

export class Snapshot extends Schema.Class<Snapshot>("Snapshot")({
  image: Image,
  instructions: Instructions,
}) {}
