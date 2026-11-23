import { useCallback, useEffect, useRef, useState } from 'react'
import {
  REFERENCE_ITEM_PAGE_SIZE,
  type ReferenceItemListResponse,
  type SelectedReference
} from '../../../../../shared/types'
import { COMPOSER_REFERENCE_KINDS } from './constants'
import { getScopeKey } from './utils'

const QUERY_DELAY_MS = 150

type MentionState = {
  query: string | null
  resultQuery: string | null
  options: SelectedReference[]
  workspaceRoots: ReferenceItemListResponse['workspaceRoots']
  activeIndex: number
  pending: boolean
  loadingMore: boolean
  hasMore: boolean
  nextOffset: number
}

const closedMention: MentionState = {
  query: null,
  resultQuery: null,
  options: [],
  workspaceRoots: {},
  activeIndex: 0,
  pending: false,
  loadingMore: false,
  hasMore: false,
  nextOffset: 0
}

export function useReferenceMention(getInsertedKeys?: () => ReadonlySet<string>) {
  const [state, setState] = useState(closedMention)
  const current = useRef(closedMention)
  const requestVersion = useRef(0)
  const timer = useRef<number | undefined>(undefined)

  const update = useCallback((next: MentionState): void => {
    current.current = next
    setState(next)
  }, [])

  const invalidate = useCallback((): void => {
    window.clearTimeout(timer.current)
    requestVersion.current += 1
  }, [])

  useEffect(() => invalidate, [invalidate])

  const close = useCallback((): void => {
    invalidate()
    if (current.current.query !== null) update(closedMention)
  }, [invalidate, update])

  const fetchPage = useCallback(
    async (query: string, append: boolean): Promise<void> => {
      const version = requestVersion.current
      let offset = append ? current.current.nextOffset : 0
      try {
        while (version === requestVersion.current) {
          const page = await window.api.referenceItemList({
            referenceKinds: COMPOSER_REFERENCE_KINDS,
            query,
            offset,
            limit: REFERENCE_ITEM_PAGE_SIZE
          })
          if (version !== requestVersion.current) return
          const inserted = getInsertedKeys?.()
          const options = page.items.filter((item) => !inserted?.has(getScopeKey(item)))
          const nextOffset = page.offset + page.items.length
          const hasMore = page.hasMore && nextOffset > offset
          if (!options.length && hasMore) {
            offset = nextOffset
            continue
          }
          const previous = current.current
          update({
            ...previous,
            resultQuery: query,
            options: append ? [...previous.options, ...options] : options,
            workspaceRoots: append
              ? { ...previous.workspaceRoots, ...page.workspaceRoots }
              : page.workspaceRoots,
            activeIndex: append ? previous.activeIndex : 0,
            pending: false,
            loadingMore: false,
            hasMore,
            nextOffset
          })
          return
        }
      } catch {
        if (version !== requestVersion.current) return
        const previous = current.current
        update(
          append
            ? { ...previous, loadingMore: false }
            : { ...closedMention, query, resultQuery: query }
        )
      }
    },
    [getInsertedKeys, update]
  )

  const search = useCallback(
    (query: string): void => {
      const previous = current.current
      if (query === previous.query) return
      invalidate()
      update({ ...previous, query, pending: true, loadingMore: false })
      if (previous.query === null) {
        void fetchPage(query, false)
      } else {
        timer.current = window.setTimeout(() => void fetchPage(query, false), QUERY_DELAY_MS)
      }
    },
    [fetchPage, invalidate, update]
  )

  const loadMore = useCallback((): void => {
    const previous = current.current
    if (previous.query === null || previous.pending || previous.loadingMore || !previous.hasMore)
      return
    update({ ...previous, loadingMore: true })
    void fetchPage(previous.query, true)
  }, [fetchPage, update])

  const move = useCallback(
    (direction: number): void => {
      const previous = current.current
      const count = previous.options.length
      if (previous.pending || !count) return
      update({ ...previous, activeIndex: (previous.activeIndex + count + direction) % count })
    },
    [update]
  )

  const canSelect = useCallback(
    (query: string): boolean => !current.current.pending && current.current.resultQuery === query,
    []
  )

  const getCurrent = useCallback(() => current.current, [])

  return { state, getCurrent, search, close, loadMore, move, canSelect }
}
