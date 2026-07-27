export type Pass = Readonly<{ pass: boolean }>;

export const countCorrect = (results: ReadonlyArray<Readonly<{ grade: Pass }>>) =>
  results.reduce((count, result) => count + Number(result.grade.pass), 0);

export const estimatePassAtK = (total: number, correct: number, k: number) => {
  if (total - correct < k) {
    return 1;
  }

  let allFail = 1;
  for (let i = 0; i < k; i += 1) {
    allFail *= (total - correct - i) / (total - i);
  }
  return 1 - allFail;
};

export const estimatePassPowK = (total: number, correct: number, k: number) => {
  if (correct < k) {
    return 0;
  }

  let allPass = 1;
  for (let i = 0; i < k; i += 1) {
    allPass *= (correct - i) / (total - i);
  }
  return allPass;
};
