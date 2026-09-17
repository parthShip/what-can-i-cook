import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node environment only: everything under test here is server-side or pure. There is
// no jsdom dependency, which keeps the install small and the run fast.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    // Mirrors the `@/*` path in tsconfig.json so tests import the way the app does.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
