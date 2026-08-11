import tailwindcss from "@tailwindcss/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    VitePWA({
      outDir: "build/client",
      registerType: "autoUpdate",
      includeAssets: ["koan.svg"],
      manifest: {
        name: "KOAN Agent Gateway",
        short_name: "KOAN",
        description: "Your coding agents, from anywhere in your tailnet.",
        theme_color: "#f5f5f7",
        background_color: "#f5f5f7",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "/koan.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: {
        additionalManifestEntries: [{ url: "/index.html", revision: null }],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/ws$/],
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.startsWith("/api/") || url.pathname === "/ws",
          handler: "NetworkOnly",
        }],
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
});
