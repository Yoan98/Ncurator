export const DESKTOP_ACCOUNT_COMMAND = 'desktop-account:command'
export const DESKTOP_ACCOUNT_CHANGED = 'desktop-account:changed'

export type DesktopAccountCommand =
  | 'restore'
  | 'begin'
  | 'cancel'
  | 'logout'
  | 'profile'
  | 'wallet'
  | 'refresh-wallet'
export type DesktopWallet = {
  currency: 'CNY'
  version: string
  available: string
  balance: string
  usageFrozen: string
  refundFrozen: string
  debt: string
  settlementPending: boolean
}

export type DesktopAccountSnapshot =
  | { status: 'signed_out' | 'authorizing' | 'restoring' | 'expired' | 'unsupported' }
  | {
      status: 'signed_in'
      userNo: string
      maskedEmail?: string | null
      wallet?: DesktopWallet
      walletStale?: boolean
    }
  | { status: 'unavailable'; userNo?: string }
  | { status: 'storage_unavailable' | 'restart_authorization' | 'logout_incomplete' }
