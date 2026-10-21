import type { ReactNode } from 'react'

export default function SettingsGroup({
  title,
  children
}: {
  title: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="nc-settings-group" aria-label={title}>
      <h2 className="nc-settings-group-title">{title}</h2>
      <div className="nc-settings-panel nc-settings-rows">{children}</div>
    </section>
  )
}

export function SettingsRow({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="nc-settings-row">
      <div className="nc-settings-row-copy">
        <div className="nc-settings-row-title">{title}</div>
        <div className="nc-settings-row-description">{description}</div>
      </div>
      <div className="nc-settings-row-control">{children}</div>
    </div>
  )
}
