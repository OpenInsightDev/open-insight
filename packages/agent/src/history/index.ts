import { Context } from "effect";

export type Histroy = Readonly<{}>;

export class Service extends Context.Service<Service, Histroy>()("open-insight/Histroy") {}
