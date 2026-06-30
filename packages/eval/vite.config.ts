import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  pack: {
    dts: {
      tsgo: true,
    },
    entry: {
      internal: "src/index.ts",
      index: "src/export.ts",
    },
    exports: {
      devExports: true,
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
