import { Context } from "effect";
import type { Persist } from "./schema.ts";

/** Provides the event stream persistence sink. */
export class Service extends Context.Service<Service, Persist>()("event/Persist") {}
