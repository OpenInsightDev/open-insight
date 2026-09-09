import { expect, test } from "vite-plus/test";
import { NetworkOperationFailed } from "../src/index.ts";

test("NetworkOperationFailed is tagged with its operation", () => {
  const error = NetworkOperationFailed.make({ operation: "create", cause: new Error("boom") });
  expect(error._tag).toBe("NetworkOperationFailed");
  expect(error.operation).toBe("create");
});
