import { Prompt } from "@open-insight/core/internal";
import { expect, it } from "vite-plus/test";
import { avgPassAtK } from "./builtin/passk.ts";
import { mapGrade } from "./index.ts";

const trail = (simPass: boolean) => ({ grade: { simPass }, trajectory: Prompt.empty });

it("maps benchmark grades", async () => {
  const metric = mapGrade<{ simPass: boolean }>()(avgPassAtK(1), ({ simPass }) => ({
    pass: simPass,
  }));
  const results = {
    first: [trail(true), trail(false)],
    second: [trail(true), trail(true)],
  };

  await expect(metric(results, { ...trail(true), task: "second" }, null)).resolves.toEqual({
    "pass@k": 0.75,
  });
});
