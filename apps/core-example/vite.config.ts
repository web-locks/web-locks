import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/vanilla/" : "/",
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@web-locks/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
}));
