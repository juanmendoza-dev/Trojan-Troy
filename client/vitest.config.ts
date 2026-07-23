import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "libsodium-wrappers": path.resolve(__dirname, "node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js"),
    },
  },
  test: {
    environment: "node",
    // Vitest's default glob also matches *.spec.ts; keep it from trying to run
    // the Playwright specs under e2e/ (those use @playwright/test, not vitest).
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
