import { Dropdown, type MenuProps, App } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  HiOutlineArrowLeftOnRectangle,
  HiOutlineChartBar,
  HiOutlineChevronUp,
  HiOutlineCog6Tooth,
  HiOutlinePlusCircle,
  HiOutlineQuestionMarkCircle,
  HiOutlineUser,
  HiOutlineWallet
} from 'react-icons/hi2'
import { useDesktopAccount } from '../../contexts/DesktopAccountProvider'
import { getManualUrl, t } from '../../i18n'
import { walletAmount } from './walletAmount'

export function DesktopAccountMenu() {
  const { snapshot, run } = useDesktopAccount()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  if (snapshot.status === 'unsupported') return null

  const signedIn = snapshot.status === 'signed_in'
  const identity = signedIn ? snapshot.maskedEmail || snapshot.userNo : t(($) => $.account.title)
  const openSettings = () => navigate('/settings/account')
  const items: MenuProps['items'] = [
    {
      type: 'group',
      label: (
        <div className="flex min-w-0 items-center gap-2 px-1 py-1">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#EFEFED]">
            <HiOutlineUser />
          </span>
          <div className="min-w-0">
            <div className="break-all text-[#37352F]">{identity}</div>
            {signedIn && <div className="text-xs">{t(($) => $.account.signedIn)}</div>}
          </div>
        </div>
      )
    },
    { type: 'divider' },
    ...(signedIn
      ? [
          {
            key: 'balance',
            icon: <HiOutlineWallet />,
            label: (
              <span className="flex justify-between gap-3">
                {t(($) => $.account.balance)}
                <span className="tabular-nums">
                  {snapshot.wallet ? walletAmount(snapshot.wallet.available) : '—'}
                </span>
              </span>
            ),
            onClick: openSettings
          },
          {
            key: 'recharge',
            icon: <HiOutlinePlusCircle />,
            label: t(($) => $.account.recharge),
            disabled: true
          },
          {
            key: 'usage',
            icon: <HiOutlineChartBar />,
            label: t(($) => $.account.usage),
            disabled: true
          }
        ]
      : [
          {
            key: 'login',
            icon: <HiOutlineUser />,
            label: t(($) => $.account.login),
            onClick: openSettings
          }
        ]),
    { type: 'divider' },
    {
      key: 'settings',
      icon: <HiOutlineCog6Tooth />,
      label: t(($) => $.common.settings),
      onClick: () => navigate('/settings/general')
    },
    {
      key: 'help',
      icon: <HiOutlineQuestionMarkCircle />,
      label: t(($) => $.common.viewHelp),
      onClick: () => {
        void window.api
          .openExternal(getManualUrl())
          .then((value) => {
            if (!value.success) message.error(t(($) => $.settings.couldNotOpenHelpWebsite))
          })
          .catch(() => message.error(t(($) => $.settings.couldNotOpenHelpWebsite)))
      }
    },
    ...(signedIn
      ? [
          { type: 'divider' as const },
          {
            key: 'logout',
            icon: <HiOutlineArrowLeftOnRectangle />,
            label: t(($) => $.account.logoutHere),
            onClick: () =>
              void run('logout')
                .then((value) => {
                  if (value.status === 'logout_incomplete')
                    message.error(t(($) => $.account.logoutRetry))
                })
                .catch(() => message.error(t(($) => $.account.logoutRetry)))
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
      overlayStyle={{ width: 252 }}
      menu={{ items, onClick: () => setOpen(false) }}
    >
      <button
        type="button"
        aria-label={t(($) => $.account.title)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="desktop-account-menu"
        className="nc-sidebar-nav-row flex min-w-0 flex-1 gap-2"
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#EFEFED]">
          <HiOutlineUser />
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{identity}</span>
        <HiOutlineChevronUp className="h-3.5 w-3.5 shrink-0 text-[#787774]" />
      </button>
    </Dropdown>
  )
}
