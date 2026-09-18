/** Default package/source E2E groups that stay opt-in (not release / daily gate). */
export const E2E_DEFAULT_EXCLUDE_GROUPS = Object.freeze([
  'provider-matrix',
  'wps-office',
  'showcase'
])

/** Flat argv for workflow.mjs: `--exclude-group <name>` repeated. */
export const e2eDefaultExcludeGroupArgs = () =>
  E2E_DEFAULT_EXCLUDE_GROUPS.flatMap((group) => ['--exclude-group', group])
