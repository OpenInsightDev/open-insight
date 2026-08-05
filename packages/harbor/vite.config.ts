import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  pack: {
    dts: false,
    clean: true,
    sourcemap: true,
    entry: {
      internal: "src/index.ts",
      index: "src/export.ts",
    },
    exports: false,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
  fmt: {},
});
