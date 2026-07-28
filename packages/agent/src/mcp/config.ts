import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Predicate, Schema } from "effect";

const Transport = Schema.declare(
  (input): input is Transport =>
    Predicate.hasProperty(input, "start") &&
    Predicate.isFunction(input.start) &&
    Predicate.hasProperty(input, "send") &&
    Predicate.isFunction(input.send) &&
    Predicate.hasProperty(input, "close") &&
    Predicate.isFunction(input.close),
  { identifier: "McpTransport" },
);

const StdioFields = {
  name: Schema.String,
  command: Schema.String,
  args: Schema.optional(Schema.Array(Schema.String)),
  cwd: Schema.optional(Schema.String),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
};
export type StdioOptions = Schema.Struct.MakeIn<typeof StdioFields>;

export class StdioServer extends Schema.TaggedClass<StdioServer>("McpStdioServer")(
  "Stdio",
  StdioFields,
) {}

const HttpFields = {
  name: Schema.String,
  url: Schema.String,
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
};
export type HttpOptions = Schema.Struct.MakeIn<typeof HttpFields>;

export class HttpServer extends Schema.TaggedClass<HttpServer>("McpHttpServer")(
  "Http",
  HttpFields,
) {}

export class CustomServer extends Schema.TaggedClass<CustomServer>("McpCustomServer")("Custom", {
  name: Schema.String,
  transport: Transport,
}) {}

export const Server = Schema.Union([StdioServer, HttpServer, CustomServer]);
export type Server = Schema.Schema.Type<typeof Server>;

export const stdio = (options: StdioOptions): StdioServer => new StdioServer(options);

export const http = (options: HttpOptions): HttpServer => new HttpServer(options);

export const fromTransport = (name: string, transport: Transport): CustomServer =>
  new CustomServer({ name, transport });
