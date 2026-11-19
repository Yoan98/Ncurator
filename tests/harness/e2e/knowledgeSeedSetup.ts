import { ensureE2EModelReady } from './modelFixture'
import { prepareIsolatedKnowledgeSeed } from './knowledgeSeed'

/** Runs outside individual case timeouts. The workflow's overall deadline still applies. */
export default async function setup(): Promise<void> {
  if (
    process.env.NCURATOR_E2E_SEED_PREPARED !== '1' ||
    process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE !== '1' ||
    !process.env.NCURATOR_E2E_KNOWLEDGE_SEED_ROOT
  )
    return
  const fixtures: unknown = JSON.parse(process.env.NCURATOR_E2E_SEED_FIXTURES || 'null')
  if (!Array.isArray(fixtures) || fixtures.some((item) => typeof item !== 'string'))
    throw new Error('Missing or invalid selected E2E fixture metadata')
  if (fixtures.length === 0) return
  const modelsPath = process.env.NCURATOR_MODELS_PATH || (await ensureE2EModelReady())
  const seed = await prepareIsolatedKnowledgeSeed({
    fixtures,
    env: { NCURATOR_MODELS_PATH: modelsPath },
    prepareMissing: true
  })
  await seed.dispose()
}
