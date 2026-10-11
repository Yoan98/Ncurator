import { useRef, useState } from 'react'

/** Successful submission stays locked until the run event removes this interaction. */
export const useInteractionSubmission = <T>(onSubmit: (value: T) => Promise<void>) => {
  const inFlight = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const submit = async (value: T): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    setError('')
    try {
      await onSubmit(value)
    } catch (cause) {
      inFlight.current = false
      setSubmitting(false)
      setError(cause instanceof Error ? cause.message : '提交失败，请重试')
    }
  }
  return { submitting, error, submit }
}
