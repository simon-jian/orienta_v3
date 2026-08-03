// @ts-check
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-server/**",
      "node_modules/**",
      "public/**",
      "coverage/**",
      "*.config.js",
      "*.config.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Deliberately just the two long-established hook rules, not the full
      // `recommended` preset — v7 bundles a large set of new React Compiler
      // readiness rules (immutability, set-state-in-effect, purity, ...)
      // that assume compiler-oriented patterns this codebase doesn't follow
      // and isn't opting into; enabling them wholesale would flag long-
      // standing, working code rather than catch real bugs.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // The existing codebase relies on this in a few narrow, deliberate
      // spots (e.g. JSON-shaped WS/HTTP payloads); prefer `unknown` there
      // instead of banning `any` outright and forcing noisy casts everywhere.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Many server modules intentionally export only types/functions with no
      // runtime default; the project has never used default exports for these.
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
);
