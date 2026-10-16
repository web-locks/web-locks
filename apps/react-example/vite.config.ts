import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/react/" : "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    // Use the workspace sources so dev, build and tests never need a package build.
    alias: {
      "@web-locks/core": source("../../packages/core/src/index.ts"),
      "@web-locks/react": source("../../packages/react/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    passWithNoTests: true,
  },
}));
