import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 第三方依赖分包（P0-1）：
 * 把体积大且更新频率低的依赖拆成稳定 chunk，页面 chunk 只留业务代码，避免首屏单 chunk 过大。
 * Vite 的 module id 为 posix 风格，但 Windows 下可能出现反斜杠，判断前先归一化。
 *
 * 注意 antd 的底层依赖有两套命名：老包 `rc-xxx`、新包 `@rc-component/xxx`（路径里形如 /@rc-component/），
 * 两者必须归入 antd 组，否则会被落到 vendor，形成 vendor ↔ antd / vendor ↔ react 的循环 chunk。
 */
function classifyChunk(id: string): string | undefined {
  // commonjs 互操作辅助模块（\0commonjsHelpers.js）被多包共享，统一放 vendor 作为叶子依赖，避免循环 chunk
  if (id.endsWith('commonjsHelpers.js')) return 'vendor'
  if (!id.includes('node_modules')) return undefined
  const normalized = id.replace(/\\/g, '/')
  if (normalized.includes('echarts') || normalized.includes('zrender')) return 'echarts'
  if (normalized.includes('frappe-gantt') || normalized.includes('html-to-image')) return 'gantt'
  if (
    normalized.includes('/antd/') ||
    normalized.includes('@ant-design') ||
    normalized.includes('/rc-') ||
    normalized.includes('@rc-component')
  ) {
    return 'antd'
  }
  if (
    normalized.includes('react-router') ||
    normalized.includes('/react/') ||
    normalized.includes('react-dom') ||
    normalized.includes('scheduler') ||
    normalized.includes('use-sync-external-store') ||
    normalized.includes('@remix-run')
  ) {
    return 'react'
  }
  return 'vendor'
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: classifyChunk,
      },
    },
  },
})
