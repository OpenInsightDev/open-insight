import { Brand, Schema } from "effect";

export const Context = Schema.String;
export type Context = Schema.Schema.Type<typeof Context> & Brand.Brand<"Context">;

const makeContext = Brand.nominal<Context>();

export const fromDir = (dir: string) => makeContext(dir);
export const RunDir = fromDir(process.cwd());
export const DontCare = fromDir("/tmp");
