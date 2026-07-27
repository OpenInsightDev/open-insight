import { Prompt } from "@open-insight/core/internal";
import { expect, it } from "vite-plus/test";
import { passAtK } from "./builtin/passk.ts";
import { mapGrade } from "./index.ts";

const trail = (simPass: boolean) => ({ grade: { simPass }, trajectory: Prompt.empty });

it("maps task grades", async () => {
  const metric = mapGrade<{ simPass: boolean }>()(passAtK(1), ({ simPass }) => ({
    pass: simPass,
  }));

  await expect(metric([trail(false), trail(true)], trail(true), null)).resolves.toEqual({
    "pass@k": 0.5,
  });
});
