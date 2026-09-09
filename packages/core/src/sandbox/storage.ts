import { Context, Effect } from "effect";

export class Storage extends Context.Service<Storage, {}>()("Storage") {}

export const make = Effect.fn(function* () {});
