import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // prototype/ is read-only reference code. examples and fixtures are test inputs, often deliberately odd
  { ignores: ['prototype/**', 'examples/**', 'fixtures/**', '**/node_modules/**', '**/dist/**', '.blueprint/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
