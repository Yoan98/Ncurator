import { localizeSystemText } from '../i18n/systemText'
import { t } from '../i18n'
const INTERNAL_ERROR_PATTERNS = [
  /langgraph/iu,
  /recursionlimit/iu,
  /graph_recursion_limit/iu,
  /structured_output_/iu,
  /prompt_json_/iu,
  /caller=/iu,
  /schema=/iu,
  /cannot read properties of/iu,
  /\b(?:typeerror|referenceerror|syntaxerror)\b/iu,
  /node_modules/iu,
  /\/src\/(?:main|renderer)\//iu,
  /\/users\/[^\s]+\/[^\s]+\.(?:ts|tsx|js|mjs)/iu,
  /\n\s*at\s+/u
]

const VC_RUNTIME_ERROR_PATTERNS = [
  /dynamic link library/iu,
  /dll initialization/iu,
  /\bdll\b/iu,
  /\b1114\b/iu
]

export const normalizeUserFacingError = (
  value: unknown,
  fallback: string = t(($) => $.common.operationFailed)
): string => {
  const message = String(value || '').trim()
  if (!message) return fallback
  const lower = message.toLowerCase()
  if (lower === 'cancelled' || lower === 'canceled' || lower === 'run cancelled')
    return t(($) => $.common.cancelled)
  if (lower === 'run not active' || lower === 'run not found')
    return t(($) => $.common.thisRunHasEnded)
  if (lower === 'session deleted') return t(($) => $.common.thisConversationWasDeleted)
  if (VC_RUNTIME_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return t(($) => $.common.couldNotLoadTheVectorModelRuntimeInstallMicrosoft)
  }
  return INTERNAL_ERROR_PATTERNS.some((pattern) => pattern.test(message))
    ? fallback
    : localizeSystemText(message)
}
