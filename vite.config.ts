import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The catalogues are imported with `with { type: "json" }`, which Node
// needs (the tests load them) and the build strips. The dev server serves
// JSON as a JavaScript module, so a browser told to expect JSON refuses it
// and every language falls back to English: dropped here, in dev only.
const catalogueImports: Plugin = {
  name: "bloks-catalogue-imports",
  apply: "serve",
  enforce: "pre",
  transform(code, id) {
    if (!id.endsWith("/src/lib/i18n.ts")) return;
    return code.replace(/(import\("\.\.\/locales\/[\w-]+\.json"), \{ with: \{ type: "json" \} \}\)/g, "$1)");
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), catalogueImports],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The OpenUI renderer's development inspector, swapped for nothing:
      // see the note in the file it points at.
      "@openuidev/devtools": fileURLToPath(new URL("./src/lib/genui/no-devtools.ts", import.meta.url)),
    },
  },
  server: {
    // Pinned to IPv4. Left to chance, "localhost" resolves to ::1 for
    // some clients and 127.0.0.1 for others, and the Electron window is
    // one of the ones that guesses wrong.
    host: "127.0.0.1",
    port: 5199,
    // Build output lives inside the repo, and watching it means every
    // package run reloads the browser mid-edit.
    watch: {
      ignored: ["**/release/**", "**/build/**", "**/dist/**", "**/electron/resources/**"],
    },
    // In development the app and the harness are two processes, so the
    // API is proxied to keep the browser on a single origin, exactly as
    // it is when packaged.
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.BLOKS_PORT || 8799}`,
      },
    },
  },
});
