import type { CaseErrorCode, CaseExecutionOutcome } from './types'

const FIXTURE_MISSING_PREFIX = '缺少测试前置文件'
const LIVE_CONFIG_MISSING_PREFIX = 'human-live 缺少模型配置'

export const resolveCaseErrorCode = (message: string): CaseErrorCode => {
  const normalized = String(message || '').trim()
  if (normalized.startsWith(FIXTURE_MISSING_PREFIX)) return 'fixture_missing'
  if (normalized.startsWith(LIVE_CONFIG_MISSING_PREFIX)) return 'live_config_missing'
  if (normalized.includes(' failed')) return 'assertion_failed'
  return 'runtime_exception'
}

export const fallbackExecutionOutcome = (input: {
  current: CaseExecutionOutcome
  caseErrorCode: CaseErrorCode
  hadEvents: boolean
}): CaseExecutionOutcome => {
  if (input.current.status !== 'unknown' || input.current.resultCode !== 'unknown') {
    return input.current
  }

  if (input.caseErrorCode === 'fixture_missing' || input.caseErrorCode === 'live_config_missing') {
    return {
      status: 'not_run',
      resultCode: 'not_run'
    }
  }

  if (input.caseErrorCode === 'assertion_failed') {
    return input.hadEvents
      ? {
          status: 'failed',
          resultCode: 'assertion_failed'
        }
      : {
          status: 'unknown',
          resultCode: 'unknown'
        }
  }

  return input.hadEvents
    ? {
        status: 'failed',
        resultCode: 'runtime_exception'
      }
    : {
        status: 'unknown',
        resultCode: 'unknown'
      }
}
