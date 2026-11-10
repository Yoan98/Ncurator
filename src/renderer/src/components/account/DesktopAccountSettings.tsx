import { App, Button } from 'antd'
import { useEffect, useState } from 'react'
import { HiOutlineUser } from 'react-icons/hi2'
import { useDesktopAccount } from '../../contexts/DesktopAccountProvider'
import type { DesktopAccountCommand } from '../../../../shared/desktopAccount'
import { t } from '../../i18n'
import { exactWalletAmount, walletAmount } from './walletAmount'

export function DesktopAccountSettings() {
  const { snapshot: account, run } = useDesktopAccount()
  const [busy, setBusy] = useState<DesktopAccountCommand>()
  const { message } = App.useApp()
  useEffect(() => {
    void window.api.desktopAccount('wallet').catch(() => {})
  }, [])
  const signedIn = account.status === 'signed_in'
  const waiting = account.status === 'authorizing'
  const restoring = account.status === 'restoring'
  const offline = account.status === 'unavailable' && !!account.userNo
  const failedLogout = account.status === 'logout_incomplete'
  const statusText: Partial<Record<typeof account.status, string>> = {
    unavailable: t(($) => $.account.error),
    expired: t(($) => $.account.expired),
    restart_authorization: t(($) => $.account.restart),
    storage_unavailable: t(($) => $.account.storage),
    logout_incomplete: t(($) => $.account.logoutRetry)
  }
  const detail = statusText[account.status]
  async function command(value: DesktopAccountCommand) {
    if (busy && value !== 'cancel') return
    setBusy(value)
    try {
      await run(value)
    } catch {
      message.error(t(($) => $.account.error))
    } finally {
      setBusy((previous) => (previous === value ? undefined : previous))
    }
  }

  return (
    <div className="h-full overflow-y-auto pb-5" data-testid="desktop-account-settings">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--notion-line)] py-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#EFEFED]">
            <HiOutlineUser />
          </span>
          <div className="min-w-0">
            <div className="break-all font-medium">
              {signedIn
                ? account.maskedEmail || account.userNo
                : waiting
                  ? t(($) => $.account.wait)
                  : restoring
                    ? t(($) => $.account.restore)
                    : offline
                      ? t(($) => $.account.unconfirmed)
                      : t(($) => $.account.signedOut)}
            </div>
            <div className="mt-0.5 text-xs text-[#787774]">
              {signedIn
                ? t(($) => $.account.signedIn)
                : waiting
                  ? t(($) => $.account.waitHint)
                  : restoring
                    ? null
                    : t(($) => $.account.original)}
            </div>
          </div>
        </div>
        {!signedIn && !restoring && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="primary"
              loading={busy === 'begin' || busy === 'logout' || busy === 'restore'}
              onClick={() => void command(failedLogout ? 'logout' : offline ? 'restore' : 'begin')}
            >
              {failedLogout
                ? t(($) => $.account.logout)
                : waiting
                  ? t(($) => $.account.reopen)
                  : offline
                    ? t(($) => $.account.retry)
                    : t(($) => $.account.login)}
            </Button>
            {waiting && (
              <Button onClick={() => void command('cancel')}>{t(($) => $.account.cancel)}</Button>
            )}
          </div>
        )}
      </div>
      {detail && (
        <p className="py-3 text-sm text-[#787774]" role="status">
          {detail}
        </p>
      )}
      {signedIn && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--notion-line)] py-4">
            <span>{t(($) => $.account.userNo)}</span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 break-all tabular-nums">{account.userNo}</span>
              <Button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(account.userNo)
                    .then(() => message.success(t(($) => $.account.copied)))
                    .catch(() => message.error(t(($) => $.account.error)))
                }
              >
                {t(($) => $.account.copy)}
              </Button>
            </div>
          </div>
          <div className="border-b border-[var(--notion-line)] py-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-[#787774]">{t(($) => $.account.balance)}</div>
              <Button
                size="small"
                type="text"
                loading={busy === 'refresh-wallet'}
                onClick={() => void command('refresh-wallet')}
              >
                {t(($) => $.account.refreshBalance)}
              </Button>
            </div>
            <div
              className="my-2 text-3xl font-semibold tabular-nums"
              data-testid="desktop-account-available"
            >
              {account.wallet ? walletAmount(account.wallet.available) : '—'}
            </div>
            {account.walletStale && (
              <p role="status" className="text-xs text-[#787774]">
                {t(($) => $.account.balanceStale)}
              </p>
            )}
            {account.wallet?.settlementPending && (
              <p role="status">{t(($) => $.account.settlementPending)}</p>
            )}
            {account.wallet && account.wallet.debt !== '0' && (
              <p className="text-xs text-[#787774]">
                {t(($) => $.account.debt)} {walletAmount(account.wallet.debt)}
              </p>
            )}
            {account.wallet &&
              (account.wallet.usageFrozen !== '0' || account.wallet.refundFrozen !== '0') && (
                <dl className="mb-2 flex flex-wrap gap-x-4 gap-y-2 text-xs">
                  <div>
                    <dt>{t(($) => $.account.currentBalance)}</dt>
                    <dd>{walletAmount(account.wallet.balance)}</dd>
                  </div>
                  {account.wallet.usageFrozen !== '0' && (
                    <div>
                      <dt>{t(($) => $.account.usageFrozen)}</dt>
                      <dd>{walletAmount(account.wallet.usageFrozen)}</dd>
                    </div>
                  )}
                  {account.wallet.refundFrozen !== '0' && (
                    <div>
                      <dt>{t(($) => $.account.refundFrozen)}</dt>
                      <dd>{walletAmount(account.wallet.refundFrozen)}</dd>
                    </div>
                  )}
                </dl>
              )}
            {account.wallet && (
              <details className="mb-3 text-xs text-[#787774]">
                <summary className="cursor-pointer">{t(($) => $.account.exactBalance)}</summary>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">
                    {exactWalletAmount(account.wallet.available)} CNY
                  </span>
                  <Button
                    size="small"
                    onClick={() => {
                      const wallet = account.wallet
                      if (wallet)
                        void navigator.clipboard
                          .writeText(exactWalletAmount(wallet.available))
                          .catch(() => message.error(t(($) => $.account.error)))
                    }}
                  >
                    {t(($) => $.account.copy)}
                  </Button>
                </div>
              </details>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="primary" disabled>
                {t(($) => $.account.recharge)}
              </Button>
              <Button disabled>{t(($) => $.account.usage)}</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--notion-line)] py-4">
            <div>
              {t(($) => $.account.logoutHere)}
              <p className="m-0 text-xs text-[#787774]">{t(($) => $.account.logoutHint)}</p>
            </div>
            <Button loading={busy === 'logout'} onClick={() => void command('logout')}>
              {t(($) => $.account.logout)}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
