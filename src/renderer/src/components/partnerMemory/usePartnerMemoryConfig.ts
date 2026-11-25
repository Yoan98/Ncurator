import { useEffect, useState } from 'react'
import {
  defaultPartnerMemoryEnabled,
  PARTNER_MEMORY_CATEGORIES
} from '../../../../shared/partnerMemory'
import { t } from '../../i18n'

export function usePartnerMemoryConfig(open: boolean, partnerId: string | null) {
  const [enabled, setEnabled] = useState(defaultPartnerMemoryEnabled)
  const [initial, setInitial] = useState(defaultPartnerMemoryEnabled)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    setError('')
    setEnabled(defaultPartnerMemoryEnabled())
    setInitial(defaultPartnerMemoryEnabled())
    setLoading(Boolean(partnerId))
    if (partnerId)
      void window.api
        .partnerMemoryGet(partnerId)
        .then((snapshot) => {
          if (!active) return
          const flags = defaultPartnerMemoryEnabled()
          snapshot.memories.forEach((memory) => {
            flags[memory.category] = memory.enabled
          })
          setEnabled(flags)
          setInitial(flags)
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
    dirty: PARTNER_MEMORY_CATEGORIES.some((category) => enabled[category] !== initial[category])
  }
}
