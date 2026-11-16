import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { OFFICIAL_ORIGINS } from '../../../shared/appPreferences'
import type { DesktopAccountCommand, DesktopAccountSnapshot } from '../../../shared/desktopAccount'
import type { ManagedModel } from '../../../shared/managedModels'
import { getRendererRuntime } from '../i18n'

const accountPages = { overview: '/account', recharge: '/account/recharge', billing: '/account/billing' } as const
type Catalog = { userNo: string; models?: ManagedModel[]; status: 'loading' | 'ready' | 'unavailable' }
type AccountContext = {
  snapshot: DesktopAccountSnapshot
  run: (command: DesktopAccountCommand) => Promise<DesktopAccountSnapshot>
  openAccountPage: (page: keyof typeof accountPages) => Promise<void>
  managedCatalog?: Catalog
  loadManagedCatalog: () => Promise<boolean>
}
const Context = createContext<AccountContext>({
  snapshot: { status: 'unsupported' },
  run: async () => ({ status: 'unsupported' }),
  openAccountPage: async () => { throw new Error('desktop_account_unavailable') },
  loadManagedCatalog: async () => false
})

export function DesktopAccountProvider({ children }: { children: ReactNode }) {
  const domestic = getRendererRuntime().distribution === 'domestic'
  const [snapshot, setSnapshot] = useState<DesktopAccountSnapshot>({
    status: domestic ? 'restoring' : 'unsupported'
  })
  const change = useRef(0)
  const catalogRequest = useRef<Promise<boolean> | undefined>(undefined)
  const [catalog, setCatalog] = useState<Catalog>()
  const rechargeReturn = useRef<{ userNo: string } | undefined>(undefined)
  const userNo = snapshot.status === 'signed_in' ? snapshot.userNo : undefined
  const currentUser = useRef(userNo)
  const applySnapshot = useCallback((value: DesktopAccountSnapshot) => {
    const next = value.status === 'signed_in' ? value.userNo : undefined
    if (currentUser.current !== next) {
      currentUser.current = next
      catalogRequest.current = undefined
      setCatalog(undefined)
    }
    setSnapshot(value)
  }, [])

  useEffect(() => {
    if (!domestic) return
    let active = true
    let changed = false
    const unsubscribe = window.api.onDesktopAccountChanged((value) => {
      changed = true
      change.current++
      applySnapshot(value)
    })
    void window.api
      .desktopAccount('restore')
      .then((value) => {
        if (active && !changed) applySnapshot(value)
      })
      .catch(() => {
        if (active && !changed) applySnapshot({ status: 'unavailable' })
      })
    return () => {
      active = false
      catalogRequest.current = undefined
      unsubscribe()
    }
  }, [domestic, applySnapshot])

  const loadManagedCatalog = useCallback(() => {
    if (!userNo || currentUser.current !== userNo) return Promise.resolve(true)
    if (catalogRequest.current) return catalogRequest.current
    setCatalog(value => ({ userNo, models: value?.userNo === userNo ? value.models : undefined, status: 'loading' }))
    const pending = window.api.managedModelsGet().catch(() => ({ status: 'unavailable' } as const))
      .then(result => {
        if (catalogRequest.current !== pending || currentUser.current !== userNo) return false
        if (result.status === 'ready') {
          setCatalog({ userNo, status: 'ready', models: result.models })
          return true
        }
        setCatalog(value => ({ userNo, status: 'unavailable', models: value?.userNo === userNo ? value.models : undefined }))
        return false
      }).finally(() => {
        if (catalogRequest.current === pending) catalogRequest.current = undefined
      })
    catalogRequest.current = pending
    return pending
  }, [userNo])

  useEffect(() => {
    rechargeReturn.current = undefined
    if (!userNo) return
    const readWallet = () => void window.api.desktopAccount('wallet').catch(() => {})
    const onFocus = () => {
      const returningFromRecharge = rechargeReturn.current?.userNo === userNo
      rechargeReturn.current = undefined
      void window.api.desktopAccount(returningFromRecharge ? 'refresh-wallet' : 'wallet').catch(() => {})
    }
    void window.api.desktopAccount('profile').catch(() => {})
    readWallet()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [userNo])

  async function run(command: DesktopAccountCommand) {
    const revision = ++change.current
    const value = await window.api.desktopAccount(command)
    if (revision === change.current) applySnapshot(value)
    return value
  }

  async function openAccountPage(page: keyof typeof accountPages) {
    if (!domestic || !userNo) throw new Error('desktop_account_unavailable')
    const returning = page === 'recharge' ? { userNo } : undefined
    if (returning) rechargeReturn.current = returning
    try {
      const result = await window.api.openExternal((getRendererRuntime().accountWebOrigin ?? OFFICIAL_ORIGINS.domestic) + accountPages[page])
      if (!result.success) throw new Error('desktop_account_page_unavailable')
    } catch (error) {
      if (returning && rechargeReturn.current === returning) rechargeReturn.current = undefined
      throw error
    }
  }

  const managedCatalog = catalog && catalog.userNo === userNo ? catalog : undefined
  return <Context.Provider value={{ snapshot, run, openAccountPage, managedCatalog, loadManagedCatalog }}>{children}</Context.Provider>
}

export const useDesktopAccount = () => useContext(Context)
