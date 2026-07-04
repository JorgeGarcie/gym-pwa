import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom gives us window / document / localStorage for the drive + db tests.
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.js"],
  },
});
