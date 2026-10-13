import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // prototype/ is read-only reference code, examples are fixtures not source
  { ignores: ['prototype/**', 'examples/**', '**/node_modules/**', '**/dist/**', '.blueprint/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
