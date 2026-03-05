import { SESSION_MEMORY_OUTPUT_CONTRACT } from '../shared/contracts'

export const buildSessionMemoryPrompt = () => {
  return [
    'You update session memory for a desktop chat assistant.',
    SESSION_MEMORY_OUTPUT_CONTRACT,
    'Do not include secrets or credentials.',
    'Keep summary concise.',
    'Use arrays of short strings.'
  ].join('\n')
}
