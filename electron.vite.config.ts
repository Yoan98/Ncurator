import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      minify: 'esbuild',
      sourcemap: false,
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          workspacePrepareWorker: resolve(
            'src/main/services/workspace/worker/workspacePrepareWorker.ts'
          ),
          pdfWorker: resolve('src/main/services/pdf/worker/pdfWorker.ts'),
          embeddingRuntimeProcess: resolve(
            'src/main/services/vector/runtime/embeddingRuntimeProcess.ts'
          )
        }
      }
    }
  },
  preload: {
    build: {
      minify: 'esbuild',
      sourcemap: false
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      minify: 'esbuild',
      sourcemap: false
    },
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
