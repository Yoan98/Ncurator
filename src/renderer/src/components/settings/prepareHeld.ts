import { flushSync } from 'react-dom'

export const PREPARE_HELD_MIN_MS = 200

export const beginPrepareHeld = (setHeld: (next: boolean) => void): number => {
  flushSync(() => {
    setHeld(true)
  })
  return Date.now()
}

export const endPrepareHeld = async (
  setHeld: (next: boolean) => void,
  startedAt: number
): Promise<void> => {
  const remaining = PREPARE_HELD_MIN_MS - (Date.now() - startedAt)
  if (remaining > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, remaining)
    })
  }
  setHeld(false)
}
