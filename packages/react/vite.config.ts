import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: true,
    exports: false,
  },
  resolve: {
    // Test-only: run against core's source so tests need no prior core build.
    alias: {
      "@web-locks/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    passWithNoTests: true,
    environment: "jsdom",
  },
});
