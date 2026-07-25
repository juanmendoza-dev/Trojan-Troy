import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "libsodium-wrappers-sumo": path.resolve(__dirname, "node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js"),
    },
  },
});
