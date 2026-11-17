import { cpSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig(() => ({
  root: "public",
  base: "/dabooty/",
  build: {
    outDir: "../dist",
    emptyOutDir: true
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/uploads": "http://127.0.0.1:3000"
    }
  },
  plugins: [
    {
      name: "copy-pages-files",
      closeBundle() {
        cpSync("public/dish-check.js", "dist/dish-check.js");
        cpSync("public/cloud.js", "dist/cloud.js");
        cpSync("public/firebase-config.js", "dist/firebase-config.js");
        cpSync("public/app.js", "dist/app.js");
        cpSync("public/.nojekyll", "dist/.nojekyll");
      }
    }
  ]
}));
