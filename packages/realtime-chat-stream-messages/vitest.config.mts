import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/page-policy.test.ts"],
  },
});
