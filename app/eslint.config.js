const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  {
    ignores: [".expo/**", ".test-build/**", "android/**", "ios/**"],
  },
  expoConfig,
  {
    rules: {
      "react-hooks/exhaustive-deps": "error",
    },
  },
]);
