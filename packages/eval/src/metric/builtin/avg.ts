export const mean = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
};

export const geoMean = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const product = values.reduce((acc, val) => acc * val, 1);
  return Math.pow(product, 1 / values.length);
};
