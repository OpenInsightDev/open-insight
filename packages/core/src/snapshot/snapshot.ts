import { Brand, Effect, Match, Crypto, Encoding } from "effect";
import * as Template from "./template.ts";
import type { Instructions } from "./inst.ts";

export type Snapshot = Readonly<{
  /**
   * The name of the snapshot.
   * Guaranteed to be unique and can be used to reference the real snapshot in the provider's storage.
   */
  name: string;
}> &
  Brand.Brand<"Snapshot">;

const nominal = Brand.nominal<Snapshot>();

type Format = "oci" | "pascal";
const formatName = ({ hashed, format }: { hashed: string; format: Format }) =>
  Match.value(format).pipe(
    Match.when("oci", () => `${Template.SNAPSHOT_NAME}:${hashed}`),
    Match.when("pascal", () => `${Template.SNAPSHOT_NAME}_${hashed}`),
    Match.exhaustive,
  );

export const make = Effect.fn(function* (
  template: Template.Template,
  { format = "oci" }: { format?: Format } = {},
) {
  const hashed = yield* Template.hash(template);
  return nominal({ name: formatName({ hashed, format }) });
});

export const derive = Effect.fn(function* ({
  snapshot,
  instructions,
  format = "oci",
}: {
  snapshot: Snapshot;
  instructions: Instructions;
  format?: Format;
}) {
  const crypto = yield* Crypto.Crypto;
  const bytes = new TextEncoder().encode(JSON.stringify({ name: snapshot.name, instructions }));
  const digest = yield* crypto.digest("SHA-256", bytes);
  const hashed = Encoding.encodeHex(digest);
  const name = formatName({ hashed, format });
  return nominal({ name });
});
