import { expect, it, vi, beforeEach, afterEach } from 'vitest'
import { readE2ESeedFixtures } from '../../../../scripts/test/e2e-seed-metadata.mjs'
const fake = vi.hoisted(() => ({
  ready: vi.fn(async () => '/fake-models'),
  dispose: vi.fn(async () => {}),
  prepare: vi.fn()
}))
vi.mock('../../../harness/e2e/modelFixture', () => ({ ensureE2EModelReady: fake.ready }))
vi.mock('../../../harness/e2e/knowledgeSeed', () => ({
  prepareIsolatedKnowledgeSeed: fake.prepare
}))
import setup from '../../../harness/e2e/knowledgeSeedSetup'
const declaration = (id: string, mode = 'cached', fixtures = "['tests/fixtures/workspace']") =>
  `runE2ECase({caseId: '${id}', ${'knowledge'}: '${mode}', fixtures: ${fixtures}})`
beforeEach(() => {
  vi.clearAllMocks()
  fake.prepare.mockResolvedValue({ dispose: fake.dispose })
})
afterEach(() => vi.unstubAllEnvs())
it('extracts and deduplicates cached literal declarations, filtering selected case ids', () => {
  const source = [
    declaration('a'),
    declaration('b'),
    declaration('cold', 'cold'),
    declaration('other', 'cached', "['tests/fixtures/other']")
  ].join(';')
  expect(readE2ESeedFixtures('case.ts', source, '^(a|b)$')).toEqual(['tests/fixtures/workspace'])
  expect(readE2ESeedFixtures('case.ts', source, '^cold$')).toEqual([])
  expect(
    readE2ESeedFixtures(
      'case.ts',
      `const CASE_ID = 'a'; ${declaration('a').replace("caseId: 'a'", 'caseId: CASE_ID')}`,
      '^a$'
    )
  ).toEqual(['tests/fixtures/workspace'])
  expect(readE2ESeedFixtures('case.ts', 'runE2ECase({...accountSetup, fixtures: []})')).toEqual([])
})
it('does not interpret comments, strings or dynamic fixture values as static metadata', () => {
  expect(
    readE2ESeedFixtures('case.ts', `// ${declaration('a')}\nconst example = "runE2ECase()"`)
  ).toEqual([])
  expect(() => readE2ESeedFixtures('case.ts', declaration('a', 'cached', 'fixtureList'))).toThrow(
    'literal array'
  )
  expect(() =>
    readE2ESeedFixtures('case.ts', "runE2ECase({...definition, knowledge: 'cached'})")
  ).toThrow('spread')
})
const enable = () => {
  vi.stubEnv('NCURATOR_E2E_SEED_PREPARED', '1')
  vi.stubEnv('NCURATOR_WORKSPACE_KNOWLEDGE_CACHE', '1')
  vi.stubEnv('NCURATOR_E2E_KNOWLEDGE_SEED_ROOT', '/fake-seed')
  vi.stubEnv('NCURATOR_E2E_SEED_FIXTURES', '["tests/fixtures/workspace"]')
  vi.stubEnv('NCURATOR_MODELS_PATH', '/existing-models')
}
it('prepares selected fixtures before tests, explicitly allowing preparation, and disposes the local copy', async () => {
  enable()
  await setup()
  expect(fake.ready).not.toHaveBeenCalled()
  expect(fake.prepare).toHaveBeenCalledWith({
    fixtures: ['tests/fixtures/workspace'],
    env: { NCURATOR_MODELS_PATH: '/existing-models' },
    prepareMissing: true
  })
  expect(fake.dispose).toHaveBeenCalledTimes(1)
})
it('propagates preparation failures rather than starting cases with a false ready result', async () => {
  enable()
  fake.prepare.mockRejectedValueOnce(new Error('seed failed'))
  await expect(setup()).rejects.toThrow('seed failed')
  expect(fake.dispose).not.toHaveBeenCalled()
})
it('does no work for an empty selection and fails closed for malformed metadata', async () => {
  enable()
  vi.stubEnv('NCURATOR_E2E_SEED_FIXTURES', '[]')
  await setup()
  expect(fake.prepare).not.toHaveBeenCalled()
  vi.stubEnv('NCURATOR_E2E_SEED_FIXTURES', '{}')
  await expect(setup()).rejects.toThrow('metadata')
})
