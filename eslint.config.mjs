import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["main.js", "node_modules/**", "__tests__/**", "__mocks__/**", "docs/**"],
  },
  eslint.configs.recommended,
  // Mirrors the Obsidian plugin review's rule set: the type-aware `no-unsafe-*`
  // family plus the two "this assertion is unnecessary" rules. Deliberately not
  // `strictTypeChecked`, which adds stylistic rules the review does not flag.
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unnecessary-type-conversion": "error",
    },
  },
  {
    // Build script: plain ESM, not covered by tsconfig's type-aware program.
    files: ["esbuild.config.mjs", "eslint.config.mjs", "jest.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
