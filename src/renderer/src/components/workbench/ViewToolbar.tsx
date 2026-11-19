import type { CSSProperties, ReactNode } from 'react'

export default function ViewToolbar({
  title,
  icon,
  badge,
  children,
  testId
}: {
  title: string
  icon: ReactNode
  badge?: ReactNode
  children?: ReactNode
  testId?: string
}) {
  return (
    <div
      className="nc-view-toolbar flex h-[44px] shrink-0 items-center justify-between gap-3 border-b border-[var(--notion-line)] bg-[var(--notion-page)] px-4"
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      data-testid={testId}
    >
      <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-[var(--notion-text)]">
        {icon}
        <span className="truncate">{title}</span>
        {badge}
      </div>
      <div className="workbench-no-drag flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  )
}
