import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/bv/",
  root: "static",
  publicDir: "../public",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  build: {
    outDir: "../static-dist",
    emptyOutDir: true,
  },
});
