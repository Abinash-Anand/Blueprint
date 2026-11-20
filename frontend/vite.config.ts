/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    // In development the API runs on :3000; in Docker, Nginx proxies /api instead. The Host header is kept, as Nginx
    // does, because the API accepts a browser's changes only when Origin and Host name the same address.
    proxy: { "/api": { target: process.env.API_PROXY ?? "http://127.0.0.1:3000", changeOrigin: false } },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
});
