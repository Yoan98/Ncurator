import esbuild from 'esbuild';
import { isDev} from '@extension/vite-config';

/**
 * @type { import('esbuild').BuildOptions }
 */
const buildOptions = {
  entryPoints: ['./index.ts', './lib/**/*.ts', './lib/**/*.tsx'],
  tsconfig: './tsconfig.json',
  bundle: false,
  target: 'es6',
  outdir: './dist',
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': isDev ? `"development"` : `"production"`,
},
};

await esbuild.build(buildOptions);
