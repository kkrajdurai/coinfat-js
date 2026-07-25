import {defineConfig, devices} from "@playwright/test";

// Real-engine coverage for the two things jsdom can only assert structurally: that
// host-page CSS cannot reach into the shadow root (and the widget's Tailwind reset
// cannot leak out), and that the modal traps and restores focus under real Tab keys.
// Kept out of `npm test` (jsdom, fast, no browser download) — run with `test:browser`.
//
// The suite serves everything itself via request interception, so there is no web
// server and no network: see test/browser/isolation.spec.ts.
// https://playwright.dev/docs/test-configuration
export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  projects: [
    {name: "chromium", use: {...devices["Desktop Chrome"]}},
    {name: "firefox", use: {...devices["Desktop Firefox"]}},
    {name: "webkit", use: {...devices["Desktop Safari"]}}
  ]
});
