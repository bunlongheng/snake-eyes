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
    // The bodies passed to worker.evaluate() run inside the extension service worker, where
    // chrome and background.js's own run() are in scope. Node never evaluates them.
    files: ["tests/extension.mjs"],
    languageOptions: { globals: { ...globals.webextensions, run: "readonly" } },
  },
  {
    files: ["tests/**/*.mjs", "scripts/**/*.mjs", "eslint.config.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.node, ...globals.browser } },
    rules: { "no-unused-vars": ["error", ignore], "no-empty": "error" },
  },
];
