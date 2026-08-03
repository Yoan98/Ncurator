import React, { useCallback, useMemo, useState } from 'react'
import type { WorkbenchMode } from '../components/workbench/types'
import { WorkbenchModeContext } from './WorkbenchModeContext'

export const WorkbenchModeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [mode, setModeState] = useState<WorkbenchMode>('ai')

  const setMode = useCallback((nextMode: WorkbenchMode): void => {
    setModeState(nextMode)
  }, [])

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode])

  return <WorkbenchModeContext.Provider value={value}>{children}</WorkbenchModeContext.Provider>
}
