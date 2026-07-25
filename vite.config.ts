import {resolve} from "node:path";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import {defineConfig} from "vite";

// The widget is a self-contained embed: preact and everything else is bundled
// (no `external`) so a single file drops onto any merchant page. Type
// declarations are emitted separately by `tsc -p tsconfig.build.json`.
// https://vite.dev/guide/build#library-mode
export default defineConfig({
  plugins: [preact(), tailwindcss()],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      name: "Coinfat",
      fileName: "coinfat",
      formats: ["es", "umd"]
    }
  }
});
