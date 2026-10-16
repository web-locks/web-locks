import { defineConfig } from "bumpp";

// Lockstep release: `vp run release` bumps every package.json in the workspace
// to one version, commits, tags and pushes. The tag push triggers release.yml.
export default defineConfig({
  recursive: true,
  commit: "release: v%s",
  tag: "v%s",
  push: true,
  install: false,
});
