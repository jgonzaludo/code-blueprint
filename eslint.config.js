import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // prototype/ is read-only reference code. examples and fixtures are test inputs, often deliberately odd
  { ignores: ['prototype/**', 'examples/**', 'fixtures/**', '**/node_modules/**', '**/dist/**', '.blueprint/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // plain node scripts have no ts globals config, so say what they run in
  { files: ['**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', URL: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly' } } },
);
