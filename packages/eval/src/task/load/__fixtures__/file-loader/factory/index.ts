import { TypeId } from "../../../../index.ts";

export let calls = 0;
export let disposed = 0;

export const reset = () => {
  calls = 0;
  disposed = 0;
};

export default async function makeTask() {
  calls += 1;

  return {
    [TypeId]: TypeId,
    name: "factory task",
    async [Symbol.asyncDispose]() {
      disposed += 1;
    },
  };
}
