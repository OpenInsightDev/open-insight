import { DateTime, Effect, Schema } from "effect";
import * as Uuid from "uuid";

export const makeID = Effect.fn(() => Effect.sync(() => Uuid.v4()));

export const IDSchema = Schema.String.pipe(
  Schema.withConstructorDefault(makeID()),
  Schema.withDecodingDefaultType(makeID()),
);

export const TimestampSchema = Schema.DateTimeUtcFromString.pipe(
  Schema.withConstructorDefault(Effect.sync(DateTime.nowUnsafe)),
  Schema.withDecodingDefaultType(Effect.sync(DateTime.nowUnsafe)),
);
export type Timestamp = Schema.Schema.Type<typeof TimestampSchema>;

export const EmptyRecord = Schema.Record(Schema.String, Schema.Never);
export type EmptyRecord = typeof EmptyRecord;
