const writers = new Map<string, () => Promise<void>>()
export const registerVideoFeedbackWriter = (
  id: string,
  writer: () => Promise<void>
): (() => void) => {
  writers.set(id, writer)
  return () => {
    if (writers.get(id) === writer) writers.delete(id)
  }
}
export const flushVideoFeedback = async (): Promise<void> => {
  for (const writer of [...writers.values()]) await writer()
}
