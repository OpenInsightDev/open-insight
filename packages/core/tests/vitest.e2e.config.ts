import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["e2e/**/*.e2e.test.ts"],
  },
});
