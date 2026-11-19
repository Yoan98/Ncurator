import path from 'node:path'

// Explicit coverage: these package cases send a request through the configured
// Workbench live model or the account acceptance fixture's real custom target.
// Listing a setup helper is not enough: many UI-only cases call it too.
const LOCAL_PROXY_CASE_FILES = new Set([
  'ai-process-stream-and-final-answer.e2e.test.ts',
  'ai-question-flow.e2e.test.ts',
  'anonymous-existing-usage.e2e.test.ts',
  'apply-workspace-collapsed-restore.e2e.test.ts',
  'approval-batch-flow.e2e.test.ts',
  'browser-use-task-panel.e2e.test.ts',
  'browser-view-lifecycle.e2e.test.ts',
  'cancelled-run-keeps-artifact.e2e.test.ts',
  'chat-without-knowledge-model.e2e.test.ts',
  'composer-attachments-context.e2e.test.ts',
  'context-clear-capsule.e2e.test.ts',
  'context-ring-usage.e2e.test.ts',
  'docx-apply-force-revert-warning.e2e.test.ts',
  'docx-apply-panel-preview-and-revert.e2e.test.ts',
  'docx-attachment-apply-status-and-cell-diff.e2e.test.ts',
  'docx-review-position-and-inline-diff.e2e.test.ts',
  'docx-selection-reference.e2e.test.ts',
  'excel-create-diff-and-revert.e2e.test.ts',
  'excel-update-diff-and-revert.e2e.test.ts',
  'image-generation-preview-and-revert.e2e.test.ts',
  'image-generation-update-preview-and-revert.e2e.test.ts',
  'interrupted-task-resume-flow.e2e.test.ts',
  'llm-retry-process-row.e2e.test.ts',
  'model-selector-and-provider-error.e2e.test.ts',
  'multi-file-apply-tabs.e2e.test.ts',
  'multi-format-selection-reference.e2e.test.ts',
  'partner-cache-cleanup.e2e.test.ts',
  'partner-create-and-name.e2e.test.ts',
  'ppt-create-diff-and-revert.e2e.test.ts',
  'ppt-update-diff-interactions.e2e.test.ts',
  'prefix-cache-retain-live.e2e.test.ts',
  'queue-message-during-run.e2e.test.ts',
  'run-navigation-snapshot-replay.e2e.test.ts',
  'run-telemetry-production-isolation.e2e.test.ts',
  'scheduled-task-busy-cancel-and-run-now.e2e.test.ts',
  'scheduled-task-trigger-and-session-refresh.e2e.test.ts',
  'send-guard-and-preferences.e2e.test.ts',
  'session-toolset-memory-persistence.e2e.test.ts',
  'stop-running-or-approval-run.e2e.test.ts',
  'subagent-approval-flow.e2e.test.ts',
  'subagent-delegation-browser-sidecar.e2e.test.ts',
  'subagent-prefix-cache-retain-live.e2e.test.ts',
  'terminal-background-service-flow.e2e.test.ts',
  'terminal-unicode-file-list.e2e.test.ts',
  'text-file-apply-preview-and-revert.e2e.test.ts',
  'timeline-day-jump.e2e.test.ts',
  'user-message-actions.e2e.test.ts',
  'user-skill-management-live.e2e.test.ts',
  'user-skill-use-live.e2e.test.ts',
  'web-read-direct-url.e2e.test.ts',
  'web-read-from-search-result.e2e.test.ts',
  'wps-office-reload-on-write-and-revert.e2e.test.ts',
  'wps-sync-dispatch-on-write-and-revert.e2e.test.ts'
])

export const checkWindowsLiveProxy = async (
  testFiles,
  { env = process.env, fetchNow = fetch, platform = process.platform } = {}
) => {
  if (platform !== 'win32' || String(env.AI_LIVE_PROVIDER || '').trim() !== 'custom') return
  if (!testFiles.some((file) => LOCAL_PROXY_CASE_FILES.has(path.basename(file)))) return
  let url
  try {
    url = new URL(String(env.AI_LIVE_BASE_URL || '').trim())
  } catch {
    throw new Error('Configure the Windows live model base URL before running Workbench tests')
  }
  // This check is for the local CLIProxyAPI only. Never send credentials on redirects.
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid Windows local test proxy base URL')
  const key = String(env.AI_LIVE_API_KEY || '').trim()
  const model = String(env.AI_LIVE_MODEL || '').trim()
  if (!key || !model)
    throw new Error('Configure the local test proxy model and key before Workbench tests')
  const base = url.pathname.replace(/\/chat\/completions\/?$/u, '').replace(/\/$/u, '') || '/v1'
  const request = async (endpoint, body, hasText) => {
    url.pathname = base + endpoint
    try {
      const response = await fetchNow(new URL(url), {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000)
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error('HTTP failure')
      }
      if (!hasText(await response.json())) throw new Error('Missing completion')
    } catch {
      throw new Error(
        `Windows local test proxy ${endpoint} did not return a real completion; identify the process listening on the configured port, check its actual config/auth location, and renew OAuth for that instance before retrying`
      )
    }
  }
  const nonEmpty = (value) => typeof value === 'string' && Boolean(value.trim())
  await request(
    '/chat/completions',
    { model, messages: [{ role: 'user', content: 'Reply with OK.' }], stream: false },
    (result) => result?.choices?.some(({ message }) => nonEmpty(message?.content))
  )
  return true
}

// Within one test run the environment is fixed. A successful probe is shared;
// a skipped phase (no matching tests or not local/custom) proves nothing.
export const createWindowsLiveProxyPreflight = (options) => {
  let verified = false
  return async (files) => {
    if (!verified) verified = Boolean(await checkWindowsLiveProxy(files, options))
  }
}
