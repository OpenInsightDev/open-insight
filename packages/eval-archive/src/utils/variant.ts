// HACK make function parameters bivariant
export type BivariantFn<Fn extends (...args: never[]) => unknown> = {
  bivarianceHack(...args: Parameters<Fn>): ReturnType<Fn>;
}["bivarianceHack"];

export type Invariant<T> = (arg: T) => T;
export type Contravariant<T> = (arg: T) => void;
export type Covariant<T> = () => T;

type Prettify<T> = { [K in keyof T]: T[K] } & {};
type _UnionToIntersection<T> =
  (T extends unknown ? Contravariant<T> : never) extends Contravariant<infer U> ? U : never;
export type UnionToIntersection<T> = Prettify<_UnionToIntersection<T>>;
