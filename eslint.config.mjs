import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "node_modules/",
    ".pnpm-store/",
    "dist/",
    "build/",
    "coverage/",
    "pnpm-lock.yaml",
  ]),
  {
    name: "wake-surfer/javascript",
    files: ["**/*.{js,cjs,mjs}"],
    plugins: {
      js,
    },
    extends: ["js/recommended"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  {
    name: "wake-surfer/commonjs",
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx,mts,cts}"],
  })),
]);
