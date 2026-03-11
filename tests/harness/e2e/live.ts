import { loadRootEnvOnce } from '../main/rootEnv'

const readEnv = (name: string): string => {
  loadRootEnvOnce()
  return String(process.env[name] || '').trim()
}

export const isAiLiveSuiteEnabled = (): boolean => readEnv('AI_LIVE_ENABLE') === '1'
