import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  pack: {
    entry: {
      internal: "src/index.ts",
      index: "src/export.ts",
    },
    dts: {
      tsgo: true,
    },
    clean: true,
    sourcemap: true,
    treeshake: true,
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
  test: {
    include: ["src/**/*.test.ts"],
  },
  fmt: {},
});
