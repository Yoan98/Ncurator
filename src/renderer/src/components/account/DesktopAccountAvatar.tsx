import { HiOutlineUser } from 'react-icons/hi2'

export function DesktopAccountAvatar({
  signedIn,
  maskedEmail,
  large = false
}: {
  signedIn: boolean
  maskedEmail?: string | null
  large?: boolean
}) {
  const initial = signedIn ? Array.from(maskedEmail?.trim().toUpperCase() ?? '')[0] : undefined
  const size = large ? 'size-10 text-base' : 'size-7 text-xs'
  const color = signedIn
    ? 'bg-[var(--notion-blue-bg)] text-[var(--notion-blue)]'
    : 'bg-[var(--notion-surface-hover)] text-[var(--notion-text-soft)]'

  return (
    <span
      aria-hidden="true"
      data-testid="desktop-account-avatar"
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${size} ${color}`}
    >
      {initial || <HiOutlineUser className={large ? 'size-5' : 'size-4'} />}
    </span>
  )
}
