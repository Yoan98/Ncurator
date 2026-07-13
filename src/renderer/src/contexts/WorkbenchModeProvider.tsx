import React, { useCallback, useMemo, useState } from 'react'
import {
  readWorkbenchModePreference,
  writeWorkbenchModePreference
} from '../components/workbench/utils'
import type { WorkbenchMode } from '../components/workbench/types'
import { WorkbenchModeContext } from './WorkbenchModeContext'

export const WorkbenchModeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [mode, setModeState] = useState<WorkbenchMode>(() =>
    readWorkbenchModePreference(window.localStorage)
  )

  const setMode = useCallback((nextMode: WorkbenchMode): void => {
    writeWorkbenchModePreference(window.localStorage, nextMode)
    setModeState(nextMode)
  }, [])

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode])

  return <WorkbenchModeContext.Provider value={value}>{children}</WorkbenchModeContext.Provider>
}
