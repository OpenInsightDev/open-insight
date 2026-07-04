import { Brand, Effect, Match, Crypto, Encoding } from "effect";
import { SNAPSHOT_NAME, type Snapshot, hash as hashSnapshot } from "./build.ts";
import type { Instructions } from "./inst.ts";

export type Handle = Readonly<{
  /**
   * The name of the snapshot handle, which is guaranteed to be unique and can be used to reference the snapshot in the provider's storage.
   */
  name: string;
}> &
  Brand.Brand<"SnapshotHandle">;

const nominal = Brand.nominal<Handle>();

type Format = "oci" | "pascal";
const formatName = ({ hashed, format }: { hashed: string; format: Format }) =>
  Match.value(format).pipe(
    Match.when("oci", () => `${SNAPSHOT_NAME}:${hashed}`),
    Match.when("pascal", () => `${SNAPSHOT_NAME}_${hashed}`),
    Match.exhaustive,
  );

export const make = Effect.fn(function* (
  snapshot: Snapshot,
  { format = "oci" }: { format?: Format },
) {
  const hashed = yield* hashSnapshot(snapshot);
  return nominal({ name: formatName({ hashed, format }) });
});

export const derive = Effect.fn(function* ({
  handle,
  instructions,
  format = "oci",
}: {
  handle: Handle;
  instructions: Instructions;
  format?: Format;
}) {
  const crypto = yield* Crypto.Crypto;
  const bytes = new TextEncoder().encode(JSON.stringify({ name: handle.name, instructions }));
  const digest = yield* crypto.digest("SHA-256", bytes);
  const hashed = Encoding.encodeHex(digest);
  const name = formatName({ hashed, format });
  return nominal({ name });
});
