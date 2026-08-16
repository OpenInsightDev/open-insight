import { Context } from "effect";

export type Persist = Readonly<{}>;

/** Provides the event stream persistence sink. */
export class Service extends Context.Service<Service, Persist>()("event/Persist") {}
