import { createContext, useContext } from 'react'
import type { WorkbenchMode } from '../components/workbench/types'

export type WorkbenchModeContextValue = {
  mode: WorkbenchMode
  setMode: (mode: WorkbenchMode) => void
}

export const WorkbenchModeContext = createContext<WorkbenchModeContextValue | null>(null)

export const useWorkbenchMode = (): WorkbenchModeContextValue => {
  const context = useContext(WorkbenchModeContext)
  if (!context) {
    throw new Error('useWorkbenchMode must be used within WorkbenchModeProvider')
  }
  return context
}
