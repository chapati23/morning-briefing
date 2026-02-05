import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import functional from "eslint-plugin-functional";
import promise from "eslint-plugin-promise";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Ignores - must be first
  { ignores: ["node_modules/", "dist/", ".trunk/", "eslint.config.js"] },

  // Base configs
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,

  // Unicorn - 100+ additional quality rules
  unicorn.configs.recommended,

  // Functional programming (lite preset - not too strict)
  functional.configs.lite,

  // Promise handling
  promise.configs["flat/recommended"],

  // TypeScript parser settings for src files
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Project-specific rule overrides
  {
    rules: {
      // Relax unicorn rules that conflict with project style
      "unicorn/prevent-abbreviations": "off", // Allow common abbreviations
      "unicorn/no-null": "off", // Allow null (common in APIs)
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      "unicorn/no-process-exit": "off", // Allow in CLI scripts
      "unicorn/prefer-top-level-await": "off", // Not always practical
      "unicorn/no-array-for-each": "off", // forEach is fine
      "unicorn/prefer-string-replace-all": "off", // replaceAll not always available
      "unicorn/prefer-string-raw": "off", // Not always clearer
      "unicorn/no-nested-ternary": "warn", // Warn instead of error
      "unicorn/prefer-at": "warn", // Suggest but don't enforce
      "unicorn/import-style": "off", // Allow both named and default imports

      // TypeScript - relax some strict rules for existing code
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      "@typescript-eslint/require-await": "off", // Allow async without await
      "@typescript-eslint/no-require-imports": "warn", // Warn for legacy code
      "@typescript-eslint/no-unnecessary-condition": "warn", // Warn instead of error
      "@typescript-eslint/restrict-plus-operands": "warn", // Warn instead of error

      // Functional - these are too strict for existing imperative code
      "functional/no-let": "off", // Let is fine
      "functional/immutable-data": "off", // Mutations are fine
      "functional/no-loop-statements": "off", // Loops are fine
      "functional/no-throw-statements": "off", // Throwing is fine
      "functional/no-return-void": "off", // Void returns are fine
      "functional/no-mixed-types": "off", // Mixed types are fine
      "functional/prefer-immutable-types": "off", // Mutable params are fine

      // Unicorn - relax some rules
      "unicorn/no-array-callback-reference": "off", // Allow passing functions directly
      "unicorn/consistent-function-scoping": "off", // Allow nested functions
      "unicorn/no-array-sort": "off", // Allow sort() - toSorted not always available
      "unicorn/numeric-separators-style": "off", // Don't enforce separator style
      "unicorn/no-immediate-mutation": "off", // Allow immediate mutations
    },
  },

  // Must be LAST - disables ESLint rules that conflict with Prettier
  eslintConfigPrettier,
);
