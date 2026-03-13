export const CASE_RETENTION_TIERS = [
  'canonical',
  'coverage',
  'diagnostic',
  'live-eval',
  'archived'
] as const

export type CaseRetentionTier = (typeof CASE_RETENTION_TIERS)[number]

export const CASE_LIFECYCLES = ['active', 'quarantined', 'deprecated', 'archived'] as const

export type CaseLifecycle = (typeof CASE_LIFECYCLES)[number]

export const CASE_RUN_POLICIES = ['gating', 'non_gating', 'manual', 'batch_only'] as const

export type CaseRunPolicy = (typeof CASE_RUN_POLICIES)[number]

export const CASE_EXPECTED_OUTCOMES = ['success', 'blocked', 'explicit_gap', 'failure'] as const

export type CaseExpectedOutcome = (typeof CASE_EXPECTED_OUTCOMES)[number]

export const MAIN_CASE_SUITES = [
  'main-ai-capability',
  'main-ai-runtime',
  'main-ai-human',
  'main-workspace-service',
  'main-workspace-migration'
] as const

export type MainCaseSuite = (typeof MAIN_CASE_SUITES)[number]

export const UI_CASE_SUITES = [
  'renderer-chat-contract',
  'renderer-import-contract',
  'renderer-search-contract',
  'e2e-chat',
  'e2e-import',
  'e2e-search',
  'e2e-chat-ai-live'
] as const

export type UiCaseSuite = (typeof UI_CASE_SUITES)[number]

export type SupportedCaseSuite = MainCaseSuite | UiCaseSuite

export type CatalogProfileId = 'human-default'

export type SharedCaseMetadata = {
  caseId: string
  title: string
  description: string
  taskGoal: string
  scenarioTags: readonly string[]
  expectedOutcome: CaseExpectedOutcome
  requiredFixtures: readonly string[]
  retentionTier: CaseRetentionTier
  lifecycle: CaseLifecycle
  runPolicy: CaseRunPolicy
  capabilityArea: string
  sourceFile: string
  profiles: readonly CatalogProfileId[]
}

export type CaseMetadataSignalFields = Pick<
  SharedCaseMetadata,
  | 'description'
  | 'taskGoal'
  | 'scenarioTags'
  | 'expectedOutcome'
  | 'requiredFixtures'
  | 'retentionTier'
  | 'lifecycle'
  | 'runPolicy'
  | 'capabilityArea'
  | 'sourceFile'
  | 'profiles'
>

export type GovernedCaseMetadata = Omit<CaseMetadataSignalFields, 'taskGoal' | 'sourceFile' | 'profiles'> &
  Partial<Pick<CaseMetadataSignalFields, 'taskGoal' | 'sourceFile' | 'profiles'>>

export type CurrentCaseCatalogEntry = SharedCaseMetadata & {
  suite: SupportedCaseSuite
  latestReport: string | null
  latestStatus: string | null
  latestRunAt: string | null
}

export type ArchivedCaseCatalogEntry = {
  caseId: string
  suite: SupportedCaseSuite | 'unknown'
  lifecycle: Extract<CaseLifecycle, 'archived' | 'deprecated'>
  reason: string
  replacementCaseId?: string
}

export const isCaseRetentionTier = (value: string): value is CaseRetentionTier =>
  CASE_RETENTION_TIERS.includes(value as CaseRetentionTier)

export const isCaseLifecycle = (value: string): value is CaseLifecycle =>
  CASE_LIFECYCLES.includes(value as CaseLifecycle)

export const isCaseRunPolicy = (value: string): value is CaseRunPolicy =>
  CASE_RUN_POLICIES.includes(value as CaseRunPolicy)

export const isCaseExpectedOutcome = (value: string): value is CaseExpectedOutcome =>
  CASE_EXPECTED_OUTCOMES.includes(value as CaseExpectedOutcome)
