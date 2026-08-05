import { Schema } from "effect";

export class ImageSource extends Schema.Class<ImageSource>("ImageSource")({
  media_type: Schema.Literals(["image/jpeg", "image/png", "image/gif", "image/webp"]),
  path: Schema.String,
}) {}

const ContentPartFields = Schema.Struct({
  type: Schema.Literals(["text", "image"]),
  text: Schema.optionalKey(Schema.NullOr(Schema.String)),
  source: Schema.optionalKey(Schema.NullOr(ImageSource)),
}).check(
  Schema.makeFilter((input) => {
    if (input.type === "text") {
      if (input.text === undefined || input.text === null) {
        return "'text' is required when type is 'text'";
      }
      if (input.source !== undefined && input.source !== null) {
        return "'source' is not allowed when type is 'text'";
      }
    } else {
      if (input.source === undefined || input.source === null) {
        return "'source' is required when type is 'image'";
      }
      if (input.text !== undefined && input.text !== null) {
        return "'text' is not allowed when type is 'image'";
      }
    }
    return undefined;
  }),
);

export class ContentPart extends Schema.Class<ContentPart>("ContentPart")(ContentPartFields) {}
