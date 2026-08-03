import { defineConfig } from "tsup"

// Publishable build: ESM + type declarations. `zod` (incl. the `zod/v4`
// subpath) stays external — it's a runtime dependency the consumer installs,
// not something we bundle.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: [/^zod(\/|$)/],
})
