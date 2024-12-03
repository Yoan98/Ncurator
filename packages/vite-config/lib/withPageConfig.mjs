import { defineConfig } from 'vite';
import { watchRebuildPlugin } from '@extension/hmr';
import react from '@vitejs/plugin-react-swc';
import deepmerge from 'deepmerge';
import { isDev, isProduction } from './env.mjs';
import removeConsole from 'vite-plugin-remove-console';

export const watchOption = isDev ? {
  buildDelay: 100,
  chokidar: {
    ignored:[
      /\/packages\/.*\.(ts|tsx|map)$/
    ]
  }
}: undefined;

/**
 * @typedef {import('vite').UserConfig} UserConfig
 * @param {UserConfig} config
 * @returns {UserConfig}
 */
export function withPageConfig(config) {
  return defineConfig(
    deepmerge(
      {
        base: '',
        plugins: [react(), isDev && watchRebuildPlugin({ refresh: true }), isProduction && removeConsole({
            // 只移除 console.log() 和 debugger，保留其他 console 语句
            removeConsole: ['log','time','timeEnd'],
            removeDebugger: true,
          })],
        build: {
          sourcemap: isDev,
          minify: isProduction,
          reportCompressedSize: isProduction,
          emptyOutDir: isProduction,
          watch: watchOption,
          rollupOptions: {
            external: ['chrome'],
          }
        },
        define: {
          'process.env.NODE_ENV': isDev ? `"development"` : `"production"`,
        },
        envDir: '../..'
      },
      config,
    ),
  );
}
