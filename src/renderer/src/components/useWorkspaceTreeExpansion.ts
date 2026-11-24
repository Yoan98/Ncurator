import { useCallback, useEffect, useState } from 'react'

type ExpandedDirectories = Record<string, string[]>

export const getVisibleExpandedPaths = (paths: string[]): string[] =>
  paths.filter((path) => {
    if (!paths.includes('')) return false
    const segments = path.split('/')
    return segments.every((_, index) => paths.includes(segments.slice(0, index).join('/')))
  })

export const useWorkspaceTreeExpansion = (view: 'settings' | 'workbench') => {
  const storageKey = `nc.${view}.workspace-tree.expanded`
  const [expandedDirectories, setExpandedDirectories] = useState<ExpandedDirectories>(() => {
    try {
      const saved: ExpandedDirectories | null = JSON.parse(
        window.localStorage.getItem(storageKey) || 'null'
      )
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
      return Object.fromEntries(
        Object.entries(saved).filter(
          ([, paths]) => Array.isArray(paths) && paths.every((path) => typeof path === 'string')
        )
      )
    } catch {
      return {}
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(expandedDirectories))
    } catch {
      // Storage failures still allow expanding and collapsing for the current page.
    }
  }, [expandedDirectories, storageKey])

  const setDirectoryExpanded = useCallback(
    (workspaceId: string, relativePath: string, expanded: boolean): void => {
      setExpandedDirectories((current) => {
        const paths = current[workspaceId] || []
        if (paths.includes(relativePath) === expanded) return current
        return {
          ...current,
          [workspaceId]: expanded
            ? [...paths, relativePath]
            : paths.filter((path) => path !== relativePath)
        }
      })
    },
    []
  )

  return { expandedDirectories, setDirectoryExpanded }
}
