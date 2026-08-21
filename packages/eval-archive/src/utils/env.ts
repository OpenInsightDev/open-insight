import { pipe } from "effect";

export const env = (key: string) => {
  const value = process.env[key];
  if (value === undefined) {
    throw new Error(`Environment variable ${key} is not defined`);
  }
  return value;
};

export const envExists = (key: string) => {
  return process.env[key] !== undefined;
};

export const envify = <R extends Record<string, any> = Record<string, any>>(
  map: R,
): Record<string, string> =>
  pipe(Object.entries(map), (entries) =>
    entries.reduce(
      (acc, [key, value]) => {
        if (typeof value === "function") {
          throw new Error(`Environment variable ${key} is a function, which is not allowed`);
        }

        if (typeof value === "object") {
          acc[key] = JSON.stringify(value);
        } else if (value !== undefined) {
          acc[key] = String(value);
        }

        return acc;
      },
      {} as Record<string, string>,
    ),
  );
