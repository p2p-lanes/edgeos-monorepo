import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vite"

// https://vitejs.dev/config/
export default defineConfig({
  envDir: path.resolve(__dirname, ".."),
  server: {
    open: false,
    proxy: {
      "/api/ai": {
        target: process.env.AI_SERVICE_URL ?? "http://localhost:3002",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // Serve the workspace package as source instead of pre-bundling it.
    // Vite keys the dep cache on the lockfile and this config, never on a
    // linked package's own source, so pre-bundling it meant every new export
    // added to shared-form-ui kept 404-ing out of a stale
    // node_modules/.vite until someone deleted the cache by hand.
    exclude: ["@edgeos/shared-form-ui"],
    // Its dependencies still get pre-bundled. Only the ones the backoffice
    // does not depend on directly need naming — the rest (clsx, lucide-react,
    // tailwind-merge, class-variance-authority, the Radix primitives,
    // react-markdown, remark-gfm) are already optimized as first-party deps.
    include: [
      "@edgeos/shared-form-ui > @tiptap/extensions",
      "@edgeos/shared-form-ui > @tiptap/react",
      "@edgeos/shared-form-ui > @tiptap/starter-kit",
      "@edgeos/shared-form-ui > react-phone-number-input",
      "@edgeos/shared-form-ui > remark-breaks",
      "@edgeos/shared-form-ui > tiptap-markdown",
    ],
  },
  ssr: {
    noExternal: ["@edgeos/shared-form-ui"],
  },
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          router: ["@tanstack/react-router", "@tanstack/react-query"],
          editor: ["@monaco-editor/react"],
        },
      },
    },
  },
})
