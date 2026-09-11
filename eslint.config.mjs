import js from "@eslint/js";
import globals from "globals";

const ignore = { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" };

export default [
  js.configs.recommended,
  { ignores: ["node_modules/**", "tests/screenshots/**", "docs/**"] },
  {
    files: ["overlay.js", "background.js", "lib/pure.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: { ...globals.browser, ...globals.webextensions, module: "readonly" } },
    rules: { "no-unused-vars": ["error", ignore], "no-empty": "error" },
  },
  {
    files: ["tests/**/*.mjs", "scripts/**/*.mjs", "eslint.config.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.node, ...globals.browser } },
    rules: { "no-unused-vars": ["error", ignore], "no-empty": "error" },
  },
];
