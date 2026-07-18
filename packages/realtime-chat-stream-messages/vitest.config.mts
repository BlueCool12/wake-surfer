import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/http-adapter.test.ts", "test/page-policy.test.ts"],
  },
});
