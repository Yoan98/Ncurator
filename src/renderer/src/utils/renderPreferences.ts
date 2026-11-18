/**
 * Renderer-only display preferences that never leave the window.
 * Stored in localStorage next to the other workbench UI preferences.
 */

import { useSyncExternalStore } from 'react'

export const STREAMING_MARKDOWN_ANIMATION_STORAGE_KEY =
  'ncurator.render.streaming-markdown-animation'

const listeners = new Set<() => void>()
let cached: boolean | null = null

const readStored = (): boolean => {
  try {
    return window.localStorage.getItem(STREAMING_MARKDOWN_ANIMATION_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

export const isStreamingMarkdownAnimationEnabled = (): boolean => {
  if (cached === null) cached = readStored()
  return cached
}

export const setStreamingMarkdownAnimationEnabled = (enabled: boolean): void => {
  cached = enabled
  try {
    window.localStorage.setItem(STREAMING_MARKDOWN_ANIMATION_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // A failed write only costs the preference, never the stream.
  }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Scroll animations follow the same opt-outs as streaming text. */
export const shouldAnimateScroll = (): boolean => {
  if (prefersReducedMotion()) return false
  try {
    return !window.api.isE2EMode()
  } catch {
    return true
  }
}

/** Effective value: user preference, minus reduced motion and automation runs. */
export const useStreamingMarkdownAnimation = (): boolean => {
  const enabled = useSyncExternalStore(subscribe, isStreamingMarkdownAnimationEnabled, () => true)
  if (!enabled || prefersReducedMotion()) return false
  try {
    return !window.api.isE2EMode()
  } catch {
    return true
  }
}
