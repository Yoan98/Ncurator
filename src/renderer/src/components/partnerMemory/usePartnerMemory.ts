import { useEffect, useRef, useState } from 'react'
import {
  PARTNER_MEMORY_LIMITS,
  type PartnerMemory,
  type PartnerMemoryCategory,
  type PartnerMemorySnapshot
} from '../../../../shared/partnerMemory'
import { t } from '../../i18n'
import { mergeMemoryEdits } from './memoryEdits'

const workingText = (memory: PartnerMemory): string => memory.draft ?? memory.confirmed
export interface MemoryEditorState {
  memory: PartnerMemory
  text: string
  saving: boolean
  dirty: boolean
  error: string
}

export function usePartnerMemory(partnerId: string) {
  const [entries, setEntries] = useState<MemoryEditorState[]>([])
  const [error, setError] = useState('')
  const controller = useRef<{
    edit: (category: PartnerMemoryCategory, text: string, previous: string) => void
    review: (
      category: PartnerMemoryCategory,
      action: 'accept' | 'reject',
      revision: number
    ) => Promise<void>
    flush: () => void
    retry: () => void
  } | null>(null)

  useEffect(() => {
    let active = true
    const states = new Map<PartnerMemoryCategory, MemoryEditorState>()
    const timers = new Map<PartnerMemoryCategory, ReturnType<typeof setTimeout>>()
    const publish = (): void => {
      if (active) setEntries([...states.values()].map((state) => ({ ...state })))
    }
    const schedule = (category: PartnerMemoryCategory): void => {
      clearTimeout(timers.get(category))
      timers.set(
        category,
        setTimeout(() => {
          void save(category)
        }, 300)
      )
    }
    const receive = (snapshot: PartnerMemorySnapshot): void => {
      if (snapshot.partnerId !== partnerId) return
      for (const memory of snapshot.memories) {
        const state = states.get(memory.category)
        if (!state) {
          states.set(memory.category, {
            memory,
            text: workingText(memory),
            saving: false,
            dirty: false,
            error: ''
          })
        } else if (memory.revision > state.memory.revision) {
          state.text = mergeMemoryEdits(workingText(state.memory), state.text, workingText(memory))
          state.memory = memory
          state.dirty = state.text !== workingText(memory)
          if (state.dirty && !state.saving && active) schedule(memory.category)
        }
      }
      if (active) setError('')
      publish()
    }
    const load = (): void => {
      void window.api
        .partnerMemoryGet(partnerId)
        .then(receive)
        .catch(() => {
          if (active) setError(t(($) => $.partnerMemory.loadError))
        })
    }
    const save = async (category: PartnerMemoryCategory): Promise<void> => {
      clearTimeout(timers.get(category))
      const state = states.get(category)
      if (!state || !state.dirty || state.saving) return
      if ([...state.text].length > PARTNER_MEMORY_LIMITS[category]) {
        state.error = t(($) => $.partnerMemory.tooLong, { limit: PARTNER_MEMORY_LIMITS[category] })
        publish()
        return
      }
      state.saving = true
      state.error = ''
      publish()
      try {
        const result = await window.api.partnerMemoryUpdate({
          partnerId,
          category,
          action: 'write',
          revision: state.memory.revision,
          content: state.text
        })
        receive(result.snapshot)
        state.dirty = state.text !== workingText(state.memory)
      } catch {
        state.error = t(($) => $.partnerMemory.saveError)
      } finally {
        state.saving = false
        publish()
        if (state.dirty && !state.error) {
          if (active) schedule(category)
          else void save(category)
        }
      }
    }
    controller.current = {
      edit: (category, text, previous) => {
        const state = states.get(category)
        if (!state) return
        state.text = mergeMemoryEdits(previous, text, state.text)
        state.dirty = state.text !== workingText(state.memory)
        state.error = ''
        publish()
        schedule(category)
      },
      review: async (category, action, revision) => {
        const state = states.get(category)
        if (!state || state.dirty || state.saving) return
        if (revision !== state.memory.revision) {
          state.error = t(($) => $.partnerMemory.reviewChanged)
          publish()
          return
        }
        state.saving = true
        state.error = ''
        publish()
        try {
          const result = await window.api.partnerMemoryUpdate({
            partnerId,
            category,
            action,
            revision
          })
          receive(result.snapshot)
          if (result.status === 'conflict') state.error = t(($) => $.partnerMemory.reviewChanged)
        } catch {
          state.error = t(($) => $.partnerMemory.saveError)
        } finally {
          state.saving = false
          publish()
          if (state.dirty && !state.error) {
            if (active) schedule(category)
            else void save(category)
          }
        }
      },
      flush: () => {
        states.forEach((_state, category) => {
          void save(category)
        })
      },
      retry: () => {
        load()
        states.forEach((state, category) => {
          state.error = ''
          void save(category)
        })
      }
    }
    const unsubscribe = window.api.onPartnerMemoryChanged(receive)
    load()
    return () => {
      active = false
      unsubscribe()
      timers.forEach(clearTimeout)
      states.forEach((_state, category) => {
        void save(category)
      })
    }
  }, [partnerId])

  return {
    entries,
    error,
    edit: (category: PartnerMemoryCategory, text: string, previous: string) =>
      controller.current?.edit(category, text, previous),
    review: (category: PartnerMemoryCategory, action: 'accept' | 'reject', revision: number) =>
      controller.current?.review(category, action, revision),
    flush: () => controller.current?.flush(),
    retry: () => controller.current?.retry()
  }
}
