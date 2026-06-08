import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolveFromDir } from "../dev-ports/lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devPorts = resolveFromDir(__dirname);

const frontendPort = Number(process.env.FRONTEND_PORT) || devPorts.ports.frontend;
const apiBaseUrl = process.env.VITE_API_BASE_URL || devPorts.env.VITE_API_BASE_URL;

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "./src/lib"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: frontendPort,
  },
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.FRONTEND_PREVIEW_PORT) || devPorts.ports.frontendPreview,
  },
  define: {
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBaseUrl),
  },
});
