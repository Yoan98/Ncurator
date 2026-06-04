import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          workspaceIndexWorker: resolve(
            'src/main/services/workspace/worker/workspaceIndexWorker.ts'
          )
        }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()],
    css: {
      preprocessorOptions: {
        less: {
          math: 'strict',
          javascriptEnabled: true
        }
      }
    }
  }
})
