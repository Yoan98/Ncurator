import { useEffect, useState } from 'react'
import type { UserSkillOption } from '../../../../shared/userSkills'
import { MAX_USER_SKILL_BODY_BYTES } from '../../../../shared/userSkills'
import { skillError } from './skillErrors'

export function usePartnerSkillDraft(open: boolean, partnerId: string | null) {
  const [options, setOptions] = useState<UserSkillOption[]>([])
  const [ids, setIds] = useState<string[]>([])
  const [initial, setInitial] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError('')
    setIds([])
    setInitial([])
    void Promise.all([
      window.api.userSkillsList(),
      partnerId
        ? window.api.userSkillsGetEnabled(partnerId)
        : Promise.resolve({ skillIds: [] as string[] })
    ])
      .then(([items, selection]) => {
        if (active) {
          setOptions(items)
          setIds(selection.skillIds)
          setInitial(selection.skillIds)
        }
      })
      .catch((error) => {
        if (active) setError(skillError(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
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
    bytes,
    dirty: [...ids].sort().join() !== [...initial].sort().join(),
    overBudget: bytes > MAX_USER_SKILL_BODY_BYTES
  }
}
