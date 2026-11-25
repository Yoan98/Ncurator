import { LuEraser, LuMessageSquare } from 'react-icons/lu'

export default function ClearChatIcon() {
  return (
    <span className="relative inline-flex h-[18px] w-[18px] shrink-0" aria-hidden="true">
      {/* Both 24-unit icons keep a 1.5px visible stroke at their rendered sizes. */}
      <LuMessageSquare className="h-[16px] w-[16px]" strokeWidth={2.25} />
      <LuEraser
        className="absolute bottom-0 right-0 h-[10px] w-[10px] bg-[var(--notion-page)] transition-colors duration-150 group-hover:bg-[var(--notion-surface-hover)]"
        strokeWidth={3.6}
      />
    </span>
  )
}
