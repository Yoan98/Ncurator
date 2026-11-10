import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DesktopAccountCommand, DesktopAccountSnapshot } from '../../../shared/desktopAccount'
import { getRendererRuntime } from '../i18n'

type AccountContext = {
  snapshot: DesktopAccountSnapshot
  run: (command: DesktopAccountCommand) => Promise<DesktopAccountSnapshot>
}
const Context = createContext<AccountContext>({
  snapshot: { status: 'unsupported' },
  run: async () => ({ status: 'unsupported' })
})

export function DesktopAccountProvider({ children }: { children: ReactNode }) {
  const domestic = getRendererRuntime().distribution === 'domestic'
  const [snapshot, setSnapshot] = useState<DesktopAccountSnapshot>({
    status: domestic ? 'restoring' : 'unsupported'
  })
  const change = useRef(0)
  const userNo = snapshot.status === 'signed_in' ? snapshot.userNo : undefined

  useEffect(() => {
    if (!domestic) return
    let active = true
    let changed = false
    const unsubscribe = window.api.onDesktopAccountChanged((value) => {
      changed = true
      change.current++
      setSnapshot(value)
    })
    void window.api
      .desktopAccount('restore')
      .then((value) => {
        if (active && !changed) setSnapshot(value)
      })
      .catch(() => {
        if (active && !changed) setSnapshot({ status: 'unavailable' })
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [domestic])

  useEffect(() => {
    if (!userNo) return
    const readWallet = () => void window.api.desktopAccount('wallet').catch(() => {})
    void window.api.desktopAccount('profile').catch(() => {})
    readWallet()
    window.addEventListener('focus', readWallet)
    return () => window.removeEventListener('focus', readWallet)
  }, [userNo])

  async function run(command: DesktopAccountCommand) {
    const revision = ++change.current
    const value = await window.api.desktopAccount(command)
    if (revision === change.current) setSnapshot(value)
    return value
  }

  return <Context.Provider value={{ snapshot, run }}>{children}</Context.Provider>
}

export const useDesktopAccount = () => useContext(Context)
