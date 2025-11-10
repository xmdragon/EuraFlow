import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      // 禁用基础的 no-unused-vars，使用 TypeScript 版本
      'no-unused-vars': 'off',
      // TypeScript 版本的 no-unused-vars，允许下划线前缀
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          args: 'after-used',
        },
      ],
      'react/react-in-jsx-scope': 'off', // React 17+ 不需要导入 React
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
];
