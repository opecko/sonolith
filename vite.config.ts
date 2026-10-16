/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "safari15" },
  // material-color-utilities ships extensionless relative ESM imports Node can't load; let Vite transform it.
  test: { server: { deps: { inline: ["@material/material-color-utilities"] } } },
});
