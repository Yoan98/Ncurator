/** E2E groups excluded from the daily source/package gate. */
export const E2E_DEFAULT_EXCLUDE_GROUPS = Object.freeze([
  'provider-matrix',
  'wps-office',
  'showcase'
])

/** E2E groups excluded from the full release regression. */
export const E2E_RELEASE_EXCLUDE_GROUPS = Object.freeze(['showcase'])

export const E2E_EXECUTION_PROFILES = Object.freeze({
  default: E2E_DEFAULT_EXCLUDE_GROUPS,
  release: E2E_RELEASE_EXCLUDE_GROUPS
})

export const e2eExcludeGroupsForProfile = (profile = 'default') => {
  const groups = E2E_EXECUTION_PROFILES[profile]
  if (!groups) throw new Error(`unsupported E2E execution profile: ${profile}`)
  return [...groups]
}

/** Flat argv for workflow.mjs: `--exclude-group <name>` repeated. */
export const e2eExcludeGroupArgs = (profile = 'default') =>
  e2eExcludeGroupsForProfile(profile).flatMap((group) => ['--exclude-group', group])

export const e2eReleaseExcludeGroupArgs = () => e2eExcludeGroupArgs('release')
