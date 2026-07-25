import tailwindcss from "@tailwindcss/vite";
import {defineConfig} from "vitest/config";

// jsdom rather than happy-dom: the mount + shadow-isolation tests lean on
// attachShadow, adoptedStyleSheets and matchMedia. Paying the slower startup once
// here beats swapping environments later.
// The Tailwind plugin is here so `theme.css?inline` compiles in test/mount.test.ts
// (otherwise it resolves to an empty string and the isolation check is vacuous).
// https://vitest.dev/config/#environment
export default defineConfig({
  plugins: [tailwindcss()],
  test: {
    // Off by default in vitest, which makes `theme.css?inline` resolve to "". On, so
    // the mount test sees the real compiled stylesheet.
    css: true,
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    // The engine tests drive real races — a superseded select, an aborted poll,
    // an orphaned timer — so they run on real timers and take a few seconds.
    // Faking them would test the fake, not the ordering that actually broke.
    testTimeout: 15000
  }
});
