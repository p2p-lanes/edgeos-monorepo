import type { MetadataRoute } from "next"

// Served by Next at /manifest.webmanifest and auto-linked into <head>.
// Generic across tenants — enough to make the portal installable; per-tenant
// name/theme/icon can be layered on later.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Edge Portal",
    short_name: "Edge",
    description: "Access your pop-up city events, passes, and applications.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
