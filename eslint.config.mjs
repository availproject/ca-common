import typescriptEslint from "@typescript-eslint/eslint-plugin";
// import tsdoc from "eslint-plugin-tsdoc";
import eslintConfigPrettier from "eslint-config-prettier";

import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  {
    ignores: [
      ".github/*",
      "**/README.md",
      "ansible/*",
      "**/node_modules",
      "**/dist",
      "**/example",
    ],
  },
  ...compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ),
  {
    plugins: {
      "@typescript-eslint": typescriptEslint,
      // tsdoc,
    },

    languageOptions: {
      globals: {
        ...globals.browser,
      },

      parser: tsParser,
      ecmaVersion: 12,
      sourceType: "module",
    },

    rules: {},
  },
  eslintConfigPrettier,
];
