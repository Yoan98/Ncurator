import { createRequire } from 'node:module'

// Global setup uses Vite's server module loader, unlike test workers. Load this Node-only
// harness through the project's declared jiti TS loader so Electron's CJS path-string export
// is not interpreted as a live Electron renderer module. No Electron mock is installed.
export default async function setup() {
  if (
    process.env.NCURATOR_E2E_SEED_PREPARED !== '1' ||
    process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE !== '1' ||
    !process.env.NCURATOR_E2E_KNOWLEDGE_SEED_ROOT
  )
    return
  const fixtures = JSON.parse(process.env.NCURATOR_E2E_SEED_FIXTURES || 'null')
  if (!Array.isArray(fixtures) || fixtures.some((value) => typeof value !== 'string'))
    throw new Error('Missing or invalid selected E2E fixture metadata')
  if (fixtures.length === 0) return
  const require = createRequire(import.meta.url)
  // Prefer the explicit project devDependency. The fallback supports an existing checkout
  // before its lockfile install without changing that checkout's shared node_modules.
  let loader
  try {
    loader = require('jiti')
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
    loader = createRequire(require.resolve('vitest/package.json'))('jiti')
  }
  const { createJiti } = loader
  const jiti = createJiti(import.meta.url, { fsCache: false })
  const { default: prepare } = await jiti.import('./knowledgeSeedSetup.ts')
  await prepare()
}
