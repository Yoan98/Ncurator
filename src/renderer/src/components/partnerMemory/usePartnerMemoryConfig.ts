import { useEffect, useState } from 'react'
import { t } from '../../i18n'

export function usePartnerMemoryConfig(open: boolean, partnerId: string | null) {
  const [enabled, setEnabled] = useState(true)
  const [initial, setInitial] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    setError('')
    setEnabled(true)
    setInitial(true)
    setLoading(Boolean(partnerId))
    if (partnerId)
      void window.api
        .partnerMemoryGet(partnerId)
        .then((snapshot) => {
          if (!active) return
          const enabled = snapshot.memories.every((memory) => memory.enabled)
          setEnabled(enabled)
          setInitial(enabled)
        })
        .catch(() => {
          if (active) setError(t(($) => $.partnerMemory.loadError))
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    return () => {
      active = false
    }
  }, [open, partnerId])
  return {
    enabled,
    setEnabled,
    loading,
    error,
    dirty: enabled !== initial
  }
}
