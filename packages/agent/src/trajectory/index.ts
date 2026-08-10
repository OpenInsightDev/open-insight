import { Context, Effect } from "effect";
import * as Middle from "./middleware.ts";

export type Trajectory = Readonly<{
  middlewares: Set<Middle.Middleware>;
  apply(state: Middle.State): Effect.Effect<Middle.State, never>;
}>;

export class Service extends Context.Service<Service, Trajectory>()("open-insight/Trajectory") {}

export const register =
  (fn: Middle.Fn, options: Middle.MetadataEncoded) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.tap(() =>
        Effect.flatMap(Service, (trajectory) =>
          Effect.map(Middle.make(fn, options), (middleware) => {
            trajectory.middlewares.add(middleware);
          }),
        ),
      ),
    );

export { type State } from "./middleware.ts";
