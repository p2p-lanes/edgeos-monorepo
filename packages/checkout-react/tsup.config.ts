import { defineConfig } from "tsup"

// Publishable build: ESM + type declarations. React and the core package are
// external (peer/runtime deps the consumer already has), so the adapter stays a
// thin re-export layer over @edgeos/checkout-core.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["react", "react-dom", "@edgeos/checkout-core"],
})
