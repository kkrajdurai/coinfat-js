import {resolve} from "node:path";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import {defineConfig} from "vite";

// Second, separate build: the CDN `<script>` bundle. The main config emits ES + UMD
// from src/index.ts; this one emits a single IIFE from src/global.ts whose default
// export (the factory) becomes a callable `window.Coinfat`. `emptyOutDir: false` so it
// appends to — rather than wipes — the main build's output. Runs after it in `build`.
export default defineConfig({
  plugins: [preact(), tailwindcss()],
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/global.ts"),
      name: "Coinfat",
      fileName: () => "coinfat.iife.js",
      formats: ["iife"]
    },
    // Global IS the factory, not a {default: factory} wrapper.
    rollupOptions: {output: {exports: "default"}}
  }
});
