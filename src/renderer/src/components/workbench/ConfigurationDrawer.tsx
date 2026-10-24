import type { ReactNode } from 'react'
import { App, Button, Drawer } from 'antd'
import { t } from '../../i18n'

export default function ConfigurationDrawer({
  open,
  title,
  extra,
  width = 480,
  busy = false,
  disabled = false,
  dirty = false,
  onClose,
  onSave,
  saveText,
  children,
  testId,
  saveTestId,
  cancelTestId,
  footerTestId,
  bodyTestId
}: {
  open: boolean
  title: string
  extra?: ReactNode
  width?: number
  busy?: boolean
  disabled?: boolean
  dirty?: boolean
  onClose: () => void
  onSave: () => void
  saveText?: string
  children: ReactNode
  bodyTestId?: string
  footerTestId?: string
  testId?: string
  saveTestId?: string
  cancelTestId?: string
}) {
  const { modal } = App.useApp()
  const close = (): void => {
    if (busy) return
    if (!dirty) {
      onClose()
      return
    }
    modal.confirm({
      title: t(($) => $.common.discardTitle),
      okText: t(($) => $.common.discard),
      cancelText: t(($) => $.common.cancel),
      onOk: onClose
    })
  }
  return (
    <Drawer
      open={open}
      title={title}
      extra={extra}
      placement="right"
      width={`min(${width}px, 100vw)`}
      onClose={close}
      maskClosable={false}
      keyboard={!busy}
      closable={!busy}
      destroyOnClose
      rootClassName="nc-configuration-drawer"
      styles={{ body: { padding: 0 }, header: { padding: '16px 24px' } }}
    >
      <div className="flex h-full min-h-0 flex-col" data-testid={testId}>
        <div
          className="nc-document-form min-h-0 flex-1 overflow-y-auto px-6 py-6"
          data-testid={bodyTestId}
        >
          {children}
        </div>
        <div
          data-testid={footerTestId}
          className="nc-config-footer flex shrink-0 justify-end gap-2 border-t border-[#EEEEEC] bg-white px-6 py-3"
        >
          <Button onClick={close} disabled={busy} data-testid={cancelTestId}>
            {t(($) => $.common.cancel)}
          </Button>
          <Button
            type="primary"
            onClick={onSave}
            loading={busy}
            disabled={disabled}
            data-testid={saveTestId}
          >
            {saveText || t(($) => $.common.save)}
          </Button>
        </div>
      </div>
    </Drawer>
  )
}
