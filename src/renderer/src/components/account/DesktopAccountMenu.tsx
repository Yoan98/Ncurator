import { Dropdown, type MenuProps, App } from 'antd'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  HiOutlineArrowLeftOnRectangle,
  HiOutlineArrowUpRight,
  HiOutlineChartBar,
  HiOutlineChevronUp,
  HiOutlineChevronRight,
  HiOutlineCog6Tooth,
  HiOutlinePlusCircle,
  HiOutlineQuestionMarkCircle,
  HiOutlineWallet
} from 'react-icons/hi2'
import { useDesktopAccount } from '../../contexts/DesktopAccountProvider'
import { getContactUrl, t } from '../../i18n'
import { walletAmount } from './walletAmount'
import { useAppUpdate } from '../../contexts/AppUpdateContext'
import { workbenchSelectors } from '../../testing/selectors'
import { DesktopAccountAvatar } from './DesktopAccountAvatar'

export function DesktopAccountMenu() {
  const { snapshot, run, openAccountPage } = useDesktopAccount()
  const { snapshot: update } = useAppUpdate()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [startingLogin, setStartingLogin] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  if (snapshot.status === 'unsupported') return null

  const signedIn = snapshot.status === 'signed_in'
  const waiting = snapshot.status === 'authorizing'
  const restoring = snapshot.status === 'restoring'
  const offline = snapshot.status === 'unavailable' && !!snapshot.userNo
  const logoutIncomplete = snapshot.status === 'logout_incomplete'
  const identity = signedIn ? snapshot.maskedEmail || snapshot.userNo : t(($) => $.account.title)
  const openSettings = () => navigate('/settings/account')
  const logOut = () =>
    void run('logout')
      .then((value) => {
        if (value.status === 'logout_incomplete') message.error(t(($) => $.account.logoutRetry))
      })
      .catch(() => message.error(t(($) => $.account.logoutRetry)))
  async function startLogin() {
    if (startingLogin) return
    setStartingLogin(true)
    trigger.current?.focus()
    try {
      const result = await run('begin')
      if (result.status === 'unavailable') message.error(t(($) => $.account.error))
      if (result.status === 'storage_unavailable') message.error(t(($) => $.account.storage))
    } catch {
      message.error(t(($) => $.account.error))
    } finally {
      setStartingLogin(false)
    }
  }
  const showOpenWebsiteError = () => message.error(t(($) => $.account.openWebsiteError))
  const openPage = (page: 'recharge' | 'billing') =>
    void openAccountPage(page).catch(showOpenWebsiteError)
  const externalLabel = (label: string) => (
    <span className="nc-account-menu-label">
      {label}
      <HiOutlineArrowUpRight aria-hidden="true" />
    </span>
  )
  const avatar = (
    <DesktopAccountAvatar signedIn={signedIn} maskedEmail={signedIn ? snapshot.maskedEmail : undefined} />
  )
  const loginLabel = restoring
    ? t(($) => $.account.restore)
    : waiting
      ? t(($) => $.account.wait)
      : t(($) => $.account.login)
  const items: MenuProps['items'] = [
    ...(signedIn
      ? [
          {
            type: 'group' as const,
            label: (
              <div className="flex min-w-0 items-center gap-2 px-1 py-1">
                {avatar}
                <div className="min-w-0">
                  <div className="break-all text-[#37352F]">{identity}</div>
                  <div className="text-xs">{t(($) => $.account.signedIn)}</div>
                </div>
              </div>
            )
          },
          { type: 'divider' as const },
          {
            key: 'balance',
            icon: <HiOutlineWallet />,
            label: (
              <span className="flex justify-between gap-3">
                {t(($) => $.account.balance)}
                <span className="ml-auto flex items-center gap-2 tabular-nums">
                  {snapshot.wallet ? walletAmount(snapshot.wallet.available) : '—'}
                  <HiOutlineChevronRight aria-hidden="true" className="text-[#91918E]" />
                </span>
              </span>
            ),
            onClick: openSettings
          },
          {
            key: 'recharge',
            icon: <HiOutlinePlusCircle />,
            label: externalLabel(t(($) => $.account.recharge)),
            onClick: () => openPage('recharge')
          },
          {
            key: 'billing',
            icon: <HiOutlineChartBar />,
            label: externalLabel(t(($) => $.account.billing)),
            onClick: () => openPage('billing')
          }
        ]
      : [
          {
            key: 'login',
            disabled: restoring || startingLogin,
            label: (
              <span className="nc-account-menu-label">
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  {avatar}
                  {logoutIncomplete ? t(($) => $.account.logout) : offline ? t(($) => $.account.retry) : loginLabel}
                  {waiting && <span className="sr-only">{t(($) => $.account.reopen)}</span>}
                </span>
                {!restoring && !offline && !logoutIncomplete && (
                  <HiOutlineArrowUpRight aria-hidden="true" />
                )}
              </span>
            ),
            onClick: logoutIncomplete ? logOut : () => void startLogin()
          }
        ]),
    { type: 'divider' },
    {
      key: 'settings',
      className: 'nc-account-menu-compact',
      icon: <HiOutlineCog6Tooth />,
      label: t(($) => $.common.settings),
      onClick: () => navigate('/settings/general')
    },
    {
      key: 'help',
      className: 'nc-account-menu-compact',
      icon: <HiOutlineQuestionMarkCircle />,
      label: externalLabel(t(($) => $.common.userHelp)),
      onClick: () => {
        void window.api
          .openExternal(getContactUrl())
          .then((result) => {
            if (!result.success) showOpenWebsiteError()
          })
          .catch(showOpenWebsiteError)
      }
    },
    ...(signedIn
      ? [
          { type: 'divider' as const },
          {
            key: 'logout',
            icon: <HiOutlineArrowLeftOnRectangle />,
            label: t(($) => $.account.logout),
            onClick: logOut
          }
        ]
      : [])
  ]
  return (
    <Dropdown
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value && signedIn) void run('wallet').catch(() => {})
      }}
      trigger={['click']}
      placement="topLeft"
      autoFocus
      overlayStyle={{ width: 260 }}
      overlayClassName="nc-account-dropdown"
      dropdownRender={(menu) => (
        <div
          className="nc-account-popup"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false)
              trigger.current?.focus()
            }
          }}
        >
          {menu}
          <div className="nc-account-version">
            <span>{t(($) => $.account.currentVersion)}</span>
            <span className="tabular-nums" data-testid={workbenchSelectors.appVersion}>
              {update ? `v${update.currentVersion}` : '—'}
            </span>
          </div>
        </div>
      )}
      menu={{ items, onClick: () => setOpen(false) }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={t(($) => $.account.title)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="desktop-account-menu"
        className="nc-sidebar-nav-row nc-account-trigger flex min-w-0 flex-1 gap-2"
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
      >
        {avatar}
        <span className="min-w-0 flex-1 truncate text-left">{identity}</span>
        <HiOutlineChevronUp className="h-3.5 w-3.5 shrink-0 text-[#787774]" />
      </button>
    </Dropdown>
  )
}
