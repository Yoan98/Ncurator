import { LuEraser, LuMessageSquare } from 'react-icons/lu'

export default function ClearChatIcon() {
  return (
    <span className="relative inline-flex h-[18px] w-[18px] shrink-0" aria-hidden="true">
      <LuMessageSquare className="h-[16px] w-[16px]" />
      <LuEraser className="absolute bottom-0 right-0 h-[10px] w-[10px] bg-[var(--notion-page)] transition-colors duration-150 group-hover:bg-[var(--notion-surface-hover)]" />
    </span>
  )
}
