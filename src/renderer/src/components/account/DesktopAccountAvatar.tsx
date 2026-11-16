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
    ? 'bg-[#F5F3EF] text-[#5F5B55]'
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
