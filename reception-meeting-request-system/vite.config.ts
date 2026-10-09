import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // API_PORT can be set in .env; it must match the port server/dev.ts listens on.
  const apiPort = loadEnv(mode, root, "").API_PORT || "3001";
  const apiProxy = { "/api": { target: `http://127.0.0.1:${apiPort}` } };

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(root, "src"),
        "@shared": path.resolve(root, "shared"),
      },
      dedupe: ["react", "react-dom"],
    },
    server: { port: 5173, proxy: apiProxy },
    preview: { port: 4173, proxy: apiProxy },
    build: { outDir: "dist" },
  };
});
