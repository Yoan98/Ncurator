import { act } from '@testing-library/react'
import type { AiRunEvent } from '../../../src/shared/types'
import type { DesktopApiMock } from './apiMock'

export const replayAiRunEvents = async (input: {
  mock: DesktopApiMock
  events: AiRunEvent[]
}): Promise<void> => {
  for (const event of input.events) {
    await act(async () => {
      input.mock.emitAiRunEvent(event)
      await Promise.resolve()
    })
  }
}
