// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // Off: the rule calls an assertion unnecessary when the expression already
      // has the asserted type, but TypeScript infers a generic call's type
      // argument FROM that assertion (`(await prisma.$queryRawUnsafe(q)) as Row[]`
      // gives T = Row[]), so the assertion is what makes the type; without it
      // the call is `unknown`. Its auto-fix stripped 40 such assertions across
      // the db repositories on 2026-10-18 and left tsc with 40 errors.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto", printWidth: 120 }],
    },
  },
);
