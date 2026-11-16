import { HiOutlineUser } from 'react-icons/hi2'

export function DesktopAccountAvatar({
  signedIn,
  maskedEmail
}: {
  signedIn: boolean
  maskedEmail?: string | null
}) {
  const [initial] = maskedEmail?.trim().toUpperCase() ?? ''
  const color = signedIn
    ? 'border border-[#C8E7D7] bg-[#DDF4E7] text-[#245741]'
    : 'bg-[var(--notion-surface-hover)] text-[var(--notion-text-soft)]'

  return (
    <span
      aria-hidden="true"
      data-testid="desktop-account-avatar"
      className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${color}`}
    >
      {signedIn && initial ? initial : <HiOutlineUser className="size-4" />}
    </span>
  )
}
