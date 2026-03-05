import type { CaseAssertion } from './types'

export const recordAssertion = (
  assertions: CaseAssertion[],
  input: {
    id: string
    pass: boolean
    details?: string
  }
) => {
  assertions.push({
    id: input.id,
    pass: input.pass,
    details: input.details
  })

  if (!input.pass) {
    throw new Error(`${input.id} failed${input.details ? `: ${input.details}` : ''}`)
  }
}
