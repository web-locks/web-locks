import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: true,
    exports: false,
    tsconfig: "./tsconfig.build.json",
  },
  run: {
    tasks: {
      build: {
        command: "vp pack",
        // Build @web-locks/core first so its dist types resolve.
        dependsOn: [{ task: "build", from: ["dependencies"] }],
      },
    },
  },
  test: {
    passWithNoTests: true,
    environment: "jsdom",
    // Test-only: run against core's source so tests need no prior core build.
    alias: {
      "@web-locks/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
});
