import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const desktopAppSecret =
    env.NCURATOR_APP_SECRET_DESKTOP || process.env.NCURATOR_APP_SECRET_DESKTOP || ''

  return {
    main: {
      define: {
        'process.env.NCURATOR_APP_SECRET_DESKTOP': JSON.stringify(desktopAppSecret)
      },
      build: {
        minify: 'esbuild',
        sourcemap: false,
        externalizeDeps: {
          exclude: ['pptx-kit']
        },
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
      server: {
        host: '127.0.0.1'
      },
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
  }
})
