import type * as Task from "../task/index.ts";
import type { Contravariant } from "../utils/variant.ts";
import { type Brand, Effect, Schema, type Scope } from "effect";
import { BenchmarkError } from "./error.ts";
import { assertNonNull } from "@/utils/type.ts";

export type Metadata = Readonly<{
  name: string;
  description: string;
  categories?: ReadonlyArray<string>;
  homepage?: string;
  registry?: string;
  authors?: ReadonlyArray<string>;
}>;
export const MetadataSchema: Schema.Schema<Metadata> = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
});

export type Benchmark<T extends Task.Task = Task.Task> = Readonly<{
  tasks: Task.Tasks<T>;
  metadata: Metadata;
}> & { _T?: T };

export type TaskOf<B> = B extends Benchmark<infer T> ? T : never;

type Builder<T extends Task.Task = Task.Task, H = never, R = never> = Effect.Effect<
  Partial<Benchmark<T>>,
  BenchmarkError,
  R
> & { _typestate?: Contravariant<H> };

export const init = <T extends Task.Task = Task.Task>(metadata: Metadata): Builder<T> =>
  Effect.succeed({ metadata });

type HasTasks = Brand.Brand<"tasks">;
export const withTasks =
  <T extends Task.Task, LR, LE>(loader: Task.Load.Loader<T, LR, LE>) =>
  <H, R>(build: Builder<T, H, R>): Builder<T, H | HasTasks, R | LR | Scope.Scope> =>
    Effect.fn(function* () {
      const tasks = yield* loader.pipe(Effect.mapError(BenchmarkError.init));
      const b = yield* build;
      return { ...b, tasks };
    })();

export const build = <T extends Task.Task, R>(
  build: Builder<T, HasTasks, R>,
): Effect.Effect<Benchmark<T>, BenchmarkError, R> =>
  Effect.map(build, ({ tasks, metadata }) => {
    assertNonNull(metadata);
    assertNonNull(tasks);
    return { tasks, metadata };
  });
