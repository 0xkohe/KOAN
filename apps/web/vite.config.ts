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
      includeAssets: [
        "favicon.svg",
        "icon-180.png",
        "icon-192.png",
        "icon-512.png",
        "icon-maskable-512.png",
        "koan.svg",
      ],
      manifest: {
        id: "/",
        name: "KOAN Agent Gateway",
        short_name: "KOAN",
        description: "Your coding agents, from anywhere in your tailnet.",
        theme_color: "#f5f5f7",
        background_color: "#f5f5f7",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "koan-pages",
              networkTimeoutSeconds: 3,
            },
          },
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/api/") || url.pathname === "/ws",
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:18787",
      "/ws": { target: "ws://127.0.0.1:18787", ws: true },
    },
  },
});
