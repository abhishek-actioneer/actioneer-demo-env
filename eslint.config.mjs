import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Ignore worktree build artifacts from sibling branches
    ".worktrees/**",
    ".claude/worktrees/**",
    // Ignore bundled vendor files in public/
    "public/assets/**",
    "public/edge-worker.js",
    // Ignore CJS scripts (they use require() by design)
    "scripts/**",
  ]),
  {
    rules: {
      // eslint-plugin-react-hooks@7 introduced React Compiler rules that produce
      // false positives when the React Compiler is not enabled. Disable until
      // the project opts into the compiler via next.config.ts.
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/static-components": "off",
      // Allow underscore-prefixed identifiers as intentionally unused
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // Disable React-specific rules in Playwright test files — Playwright's
  // `use` callback parameter triggers false-positive react-hooks/rules-of-hooks.
  {
    files: ["tests/**"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
]);

export default eslintConfig;
