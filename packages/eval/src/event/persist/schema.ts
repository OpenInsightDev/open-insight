import { Schema } from "effect";
import { Event } from "../schema.ts";

export const Sequence = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export class Metadata extends Schema.Class<Metadata>("PersistMetadata")({
  version: Schema.Literal(1),
  length: Sequence,
}) {}

export class Entry extends Schema.Class<Entry>("PersistEntry")({
  version: Schema.Literal(1),
  event: Event,
}) {}

export const Operation = Schema.Literals(["load", "append", "replay", "clear"]);
export type Operation = typeof Operation.Type;

export const Options = Schema.Struct({
  storeId: Schema.String,
});
export type Options = typeof Options.Type;

/** A backing-store or journal-integrity failure. */
export class Error extends Schema.TaggedErrorClass<Error>()("PersistError", {
  storeId: Schema.String,
  operation: Operation,
  sequence: Schema.NullOr(Sequence),
  cause: Schema.Error(),
}) {
  override get message(): string {
    const sequence = this.sequence === null ? "" : ` at sequence ${this.sequence}`;
    return `Event store "${this.storeId}" failed to ${this.operation}${sequence}: ${this.cause.message}`;
  }
}
