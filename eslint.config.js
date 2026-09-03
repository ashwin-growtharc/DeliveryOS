// @ts-check
const eslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', '.deliveryos/**', 'build/**', 'src-tauri/target/**', 'examples/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': eslint,
    },
    rules: {
      ...eslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // stdout is a wire, not a log. `src/sidecar.ts` and the MCP server both
    // speak JSON-RPC over it, and the engine is called from inside both -- so
    // a stray `console.log` anywhere in this set corrupts a protocol stream
    // and surfaces to the user as an unexplained parse error, far from its
    // cause. The comment at `src/sidecar.ts:5-8` had asserted this rule since
    // the sidecar was written; nothing enforced it. This does.
    //
    // The CLI's own command files are deliberately NOT in this set: printing
    // is their entire job. `src/cli/commands/mcp.ts` is the one exception,
    // because copying a neighbouring command's opening `console.log` into it
    // is the obvious mistake.
    files: ['src/mcp/**/*.ts', 'src/engine/**/*.ts', 'src/sidecar.ts', 'src/cli/commands/mcp.ts'],
    rules: {
      'no-console': 'error',
    },
  },
];
