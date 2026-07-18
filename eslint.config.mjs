import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      '.codex-tmp',
      '.pyinstaller',
      '.runvenv',
      'tests/logs',
      'tests/.cache',
      'artifacts/ai-test-results',
      'release-stage',
      'resources/web_crawler_sidecar/bin'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    files: ['**/*.mjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 0
    }
  },
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      '@typescript-eslint/explicit-function-return-type': 0,
      'prettier/prettier': 0,
      '@typescript-eslint/no-explicit-any': 0,
      '@typescript-eslint/no-empty-function': 0,
      'react-hooks/set-state-in-effect': 0,
      'react/prop-types': 0
    }
  },
  {
    files: [
      'src/main/services/ai/**/*.{ts,tsx}',
      'src/main/services/storage/domains/ChatStore.ts',
      'src/main/services/storage/domains/DocumentsStore.ts',
      'src/main/services/storage/domains/LlmConfigStore.ts',
      'src/main/services/vector/EmbeddingService.ts',
      'src/main/services/model/ModelService.ts',
      'src/main/ipc/handlers.ts',
      'src/preload/index.ts',
      'src/preload/api.ts',
      'src/shared/types.ts',
      'src/main/utils/serialization.ts',
      'src/main/utils/decoder.ts',
      'src/renderer/src/utils/serialization.ts',
      'src/renderer/src/pages/ChatPage.tsx',
      'src/renderer/src/pages/SettingsPage.tsx',
      'src/renderer/src/pages/SearchPage.tsx',
      'src/renderer/src/pages/ModelDownloadPage.tsx',
      'src/renderer/src/types/global.d.ts'
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression[expression.type='TSAsExpression']",
          message:
            'Avoid chained type assertions (`as X as Y`). Use decoder/type guard narrowing instead.'
        }
      ]
    }
  },
  eslintConfigPrettier,
  {
    rules: {
      'prettier/prettier': 0
    }
  }
)
