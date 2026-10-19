import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * ESLint 9 扁平配置（flat config）
 *
 * - @eslint/js + typescript-eslint 推荐规则
 * - react-hooks：rules-of-hooks 必须为 error（违反 hooks 规则的代码无法可靠工作）
 * - 只面向浏览器端代码，构建产物与工具链配置文件不在检查范围
 */
export default tseslint.config(
  // 全局忽略：构建产物、依赖、以及 Vite/Node 侧的工具链配置（tsconfig 只覆盖 src/）
  {
    ignores: ['dist', 'node_modules', 'vite.config.ts'],
  },
  // .ts / .tsx 源码：JS 推荐规则 + TS 推荐规则 + hooks 规则
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // 回调签名里用不到的参数按约定用 _ 前缀占位（如 (_taskId) => ...），不算未使用
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)
