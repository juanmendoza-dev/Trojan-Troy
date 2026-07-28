import { defineConfig, devices } from "@playwright/test";

// Visual / end-to-end layer. Unit tests stay in Vitest (src/**/*.test.ts); this
// drives the real Vite dev server in real browser engines — chiefly to eyeball
// the app at phone sizes (iOS Safari via WebKit + Android Chrome via Chromium)
// without hand-driving a browser. Because it hits the running dev server, it
// inherits the app's own Vite build, including the libsodium-wrappers alias.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // Start the dev server on a fixed port so baseURL is stable; reuse one that's
  // already running, so `npm run dev` in another terminal is picked up instead
  // of spawning a second server.
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone-safari", use: { ...devices["iPhone 13"] } },
    { name: "android-chrome", use: { ...devices["Pixel 7"] } },
  ],
});
