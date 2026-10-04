import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins:[react()],
  resolve:{alias:{
    "@":fileURLToPath(new URL("./src",import.meta.url)),
    "server-only":fileURLToPath(new URL("./tests/server-only-stub.ts",import.meta.url)),
  }},
  test:{
    environment:"node",
    include:[
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.test.{ts,tsx}",
      "tests/component/**/*.test.{ts,tsx}",
      "extension/firefox/tests/**/*.test.ts",
    ],
    setupFiles:["./vitest.setup.ts"],
    clearMocks:true,
    globals:true,
    testTimeout:15_000,
  },
});
