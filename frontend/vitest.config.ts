import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// 业务逻辑测试：数据层与服务层都是纯 TypeScript，node 环境直接跑。
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
