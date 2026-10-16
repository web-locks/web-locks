import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: true,
    exports: false,
  },
  test: {
    passWithNoTests: true,
    environment: "jsdom",
  },
});
