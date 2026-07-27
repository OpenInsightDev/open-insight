import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  pack: {
    entry: {
      internal: "src/index.ts",
      index: "src/export.ts",
      utils: "src/utils/export.ts",
    },
    dts: false,
    clean: true,
    sourcemap: true,
    treeshake: true,
    exports: false,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
  fmt: {},
});
