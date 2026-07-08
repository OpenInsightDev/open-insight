import { Brand, Schema } from "effect";

/**
 * OCI image reference (e.g. `docker.io/library/node:18-alpine`).
 */
export const Image = Schema.String.pipe(Schema.brand("Image"));
export type Image = Schema.Schema.Type<typeof Image>;

export const nominal = Brand.nominal<Image>;

const OciImageReference =
  /^(?:(?<domain>[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)(?::(?<port>\d+))?\/)?(?<repository>[a-z0-9]+(?:(?:[._]|__|[-]*)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|[-]*)[a-z0-9]+)*)*)(?::(?<tag>[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}))?(?:@(?<digest>[a-zA-Z0-9-_]+:[a-fA-F0-9]{32,}))?$/;

export const ImageFromString = Schema.String.check(
  Schema.isPattern(OciImageReference, { expected: "a valid OCI image reference" }),
).pipe(Schema.decodeTo(Image));

export const make = (image: string): Image => Schema.decodeUnknownSync(ImageFromString)(image);
