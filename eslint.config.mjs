import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", ".wrangler/**", ".agents/**", "dist/**", "extension/firefox/dist/**", "coverage/**", "playwright-report/**", "test-results/**"]),
]);
