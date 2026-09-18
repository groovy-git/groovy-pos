import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// base "./" works on any GitHub Pages path (https://<user>.github.io/<repo>/) with hash routing
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["logo.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Groovy Fragrances POS",
        short_name: "Groovy POS",
        description: "Billing, stock and reports for Groovy Fragrances",
        theme_color: "#654321",
        background_color: "#FAF7F2",
        display: "standalone",
        orientation: "portrait",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,wasm}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 20, maxAgeSeconds: 31536000 } },
          },
          {
            urlPattern: /^https:\/\/(lh3\.googleusercontent\.com|cdn2\.clevup\.in)\/.*/,
            handler: "CacheFirst",
            options: { cacheName: "product-images", expiration: { maxEntries: 400, maxAgeSeconds: 2592000 } },
          },
        ],
      },
    }),
  ],
  server: { host: true, port: 5173 },
});
