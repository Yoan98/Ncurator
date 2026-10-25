import { useEffect, useRef, useState } from 'react'
import type { UserSkillOption } from '../../../../shared/userSkills'
import { MAX_USER_SKILL_BODY_BYTES } from '../../../../shared/userSkills'
import { skillError } from './skillErrors'

export function usePartnerSkillDraft(open: boolean, partnerId: string | null) {
  const [options, setOptions] = useState<UserSkillOption[]>([])
  const [ids, setIds] = useState<string[]>([])
  const [initial, setInitial] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [externalChanged, setExternalChanged] = useState(false)
  const dirty = [...ids].sort().join() !== [...initial].sort().join()
  const dirtyRef = useRef(dirty)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError('')
    setIds([])
    setInitial([])
    setExternalChanged(false)
    const load = (refresh = false): void => {
      void Promise.all([
        window.api.userSkillsList(),
        partnerId
          ? window.api.userSkillsGetEnabled(partnerId)
          : Promise.resolve({ skillIds: [] as string[] })
      ])
        .then(([items, selection]) => {
          if (active) {
            setOptions(items)
            if (!refresh || !dirtyRef.current) {
              setIds(selection.skillIds)
              setInitial(selection.skillIds)
            } else setExternalChanged(true)
          }
        })
        .catch((error) => {
          if (active) setError(skillError(error))
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }
    load()
    const unsubscribe = window.api.onUserSkillsChanged(() => load(true))
    return () => {
      active = false
      unsubscribe()
    }
  }, [open, partnerId])
  const bytes = options
    .filter((option) => ids.includes(option.id))
    .reduce((sum, option) => sum + (option.bodyBytes ?? 0), 0)
  return {
    options,
    ids,
    setIds,
    loading,
    error,
    externalChanged,
    bytes,
    dirty,
    overBudget: bytes > MAX_USER_SKILL_BODY_BYTES
  }
}
