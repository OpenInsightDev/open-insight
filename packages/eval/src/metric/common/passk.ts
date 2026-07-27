export type Pass = Readonly<{ pass: boolean }>;
export type BooleanField<Key extends string> = Readonly<Record<Key, boolean>>;

export const countCorrectBy = <G>(
  results: ReadonlyArray<Readonly<{ grade: G }>>,
  isCorrect: (grade: G) => boolean,
) => results.reduce((count, result) => count + Number(isCorrect(result.grade)), 0);

export const countCorrect = (results: ReadonlyArray<Readonly<{ grade: Pass }>>) =>
  countCorrectBy(results, (grade) => grade.pass);

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
