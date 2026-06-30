// HACK make function parameters bivariant
// deno-lint-ignore no-explicit-any
export type Bivariant<Fn extends (...args: never[]) => any> = {
  bivarianceHack(...args: Parameters<Fn>): ReturnType<Fn>;
}["bivarianceHack"];

export type Invariant<T> = (arg: T) => T;
export type Contravariant<T> = (arg: T) => void;
export type Covariant<T> = () => T;

export type UnionToIntersection<T> =
  (T extends unknown ? Contravariant<T> : never) extends Contravariant<infer U> ? U : never;
