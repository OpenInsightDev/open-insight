import { Context } from "effect";
import type { Transport } from "./schema.ts";

export class Service extends Context.Service<Service, Transport>()("event/Transport") {}
