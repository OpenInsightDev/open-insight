import { quote } from "./bash.ts";

export type TemplateValue = string | number | boolean;
export type TemplateExpression = TemplateValue | ReadonlyArray<TemplateValue>;

export const makeScript = (
  strings: TemplateStringsArray,
  values: ReadonlyArray<TemplateExpression>,
): string => {
  let script = strings[0] ?? "";
  for (const [index, value] of values.entries()) {
    script += Array.isArray(value)
      ? value.map((item) => quote(String(item))).join(" ")
      : quote(String(value));
    script += strings[index + 1] ?? "";
  }
  return script;
};
