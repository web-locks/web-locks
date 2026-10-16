import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: true,
    exports: true,
  },
  test: {
    passWithNoTests: true,
    environment: "jsdom",
  },
});
