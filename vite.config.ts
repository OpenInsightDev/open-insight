import { defineConfig } from "vite-plus";

const workspaceSourcePatterns = ["*", "!apps", "!apps/**", "!packages", "!packages/**"];

export default defineConfig({
  staged: {
    "{apps,packages}/**": "vp check --fix",
  },
  fmt: {
    ignorePatterns: workspaceSourcePatterns,
  },
  lint: {
    ignorePatterns: workspaceSourcePatterns,
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
