import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "libsodium-wrappers": path.resolve(__dirname, "node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js"),
    },
  },
  test: {
    environment: "node",
  },
});
