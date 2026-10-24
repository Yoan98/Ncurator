import { resolve } from 'path'
import { execFileSync } from 'node:child_process'
import { defineConfig, type UserConfig } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { createKnowledgeCacheIdentity } from './scripts/build/runtime/knowledge-cache-identity.mjs'

export default defineConfig(async ({ mode }): Promise<UserConfig> => {
  execFileSync(process.execPath, [resolve('scripts/build/vditor-assets.mjs')], { stdio: 'inherit' })
  const knowledgeIdentity = await createKnowledgeCacheIdentity()
  const env = loadEnv(mode, process.cwd(), '')
  const desktopAppSecret =
    env.NCURATOR_APP_SECRET_DESKTOP || process.env.NCURATOR_APP_SECRET_DESKTOP || ''

  return {
    main: {
      plugins: [
        {
          name: 'knowledge-cache-identity',
          generateBundle() {
            this.emitFile({
              type: 'asset',
              fileName: 'knowledge-cache-identity.json',
              source: JSON.stringify(knowledgeIdentity)
            })
          }
        }
      ],
      define: {
        'process.env.NCURATOR_APP_SECRET_DESKTOP': JSON.stringify(desktopAppSecret),
        __NCURATOR_KNOWLEDGE_IDENTITY__: JSON.stringify(knowledgeIdentity)
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
          '@renderer': resolve('src/renderer/src'),
          'monaco-local': resolve('node_modules/monaco-editor/esm/vs')
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
