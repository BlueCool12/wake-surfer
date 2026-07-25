import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/",
    ".pnpm-store/",
    "**/dist/",
    "**/build/",
    "**/coverage/",
    ".codex/",
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
  {
    name: "wake-surfer/realtime-chat-table-contract-boundary",
    files: ["apps/**/*.{ts,tsx,mts,cts}", "packages/**/src/**/*.{ts,tsx,mts,cts}"],
    ignores: [
      "packages/realtime-chat-database/src/**/*.{ts,tsx,mts,cts}",
      "packages/realtime-chat-stream-messages/src/**/*.{ts,tsx,mts,cts}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@wake-surfer/realtime-chat-gateway-ticket/table-contract",
              message:
                "gateway-ticket table contract는 realtime-chat-database 패키지만 import할 수 있습니다.",
            },
            {
              name: "@wake-surfer/realtime-chat-gateway-ticket/database",
              message:
                "gateway-ticket database 서브패스는 제거되었습니다. table contract는 realtime-chat-database 패키지만 import할 수 있습니다.",
            },
            {
              name: "@wake-surfer/realtime-chat-message-send/table-contract",
              message:
                "message-send table contract는 realtime-chat-database 패키지만 import할 수 있습니다.",
            },
          ],
        },
      ],
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx,mts,cts}"],
  })),
]);
