import js from '@eslint/js';
import ts from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  { ignores: ['node_modules/**', 'dist/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.{js,mjs,cjs,ts,vue}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, WebGLContextAttributes: 'readonly' } },
    rules: { 'vue/multi-word-component-names': 'off' },
  },
  { files: ['**/*.vue'], languageOptions: { parserOptions: { parser: ts.parser } } },
  { files: ['desktop/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
