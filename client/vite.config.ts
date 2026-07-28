import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ command, mode }) => {
  // A deployed build with no relay URL would silently fall back to
  // ws://localhost:8080 (App.tsx) and every session would dead-end on the
  // error screen. Refuse to build rather than ship that.
  const env = loadEnv(mode, __dirname, "");
  if (command === "build" && !env.VITE_RELAY_URL) {
    throw new Error(
      "VITE_RELAY_URL is not set. Production builds must point at the deployed relay " +
        "(e.g. VITE_RELAY_URL=wss://your-relay.onrender.com) — without it the client " +
        "silently falls back to ws://localhost:8080."
    );
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "libsodium-wrappers-sumo": path.resolve(__dirname, "node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js"),
      },
    },
  };
});
