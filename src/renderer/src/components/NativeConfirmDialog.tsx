import { t } from '../i18n'
import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { ConfirmDialogRequest } from '../../../shared/types'

type NativeConfirmDialogProps = Omit<ConfirmDialogRequest, 'dialogId' | 'error'> & {
  open: boolean
  /** Return an error to keep the dialog open for retry; return nothing after success. */
  onConfirm: (checkboxChecked: boolean) => Promise<string | void>
  onCancel: () => void
  onError: (error: string) => void
}

export const NativeConfirmDialog = (props: NativeConfirmDialogProps): null => {
  const dialogId = useId()
  const callbacks = useRef(props)
  useLayoutEffect(() => {
    callbacks.current = props
  })
  const { open, title, message, detail, confirmText, cancelText, danger } = props
  const checkboxLabel = props.checkbox?.label
  const checkboxHelp = props.checkbox?.help

  useEffect(() => {
    if (!open) return
    let disposed = false
    const close = (): void => {
      void window.api.confirmDialogClose(dialogId).catch(console.error)
    }
    const run = async (): Promise<void> => {
      let error: string | undefined
      while (!disposed) {
        const response = await window.api.confirmDialogShow({
          dialogId,
          title,
          message,
          detail,
          confirmText,
          cancelText,
          danger,
          checkbox: checkboxLabel ? { label: checkboxLabel, help: checkboxHelp } : undefined,
          error
        })
        if (disposed) return
        if (!response.success) {
          callbacks.current.onError(response.error)
          callbacks.current.onCancel()
          return
        }
        if (response.action === 'cancel') {
          callbacks.current.onCancel()
          return
        }
        try {
          error =
            (await callbacks.current.onConfirm(response.checkboxChecked === true)) || undefined
        } catch (cause) {
          error =
            cause instanceof Error
              ? cause.message
              : t(($) => $.common.theOperationFailedPleaseTryAgain)
        }
        if (!error) {
          close()
          return
        }
      }
    }
    void run().catch((error: Error) => {
      if (disposed) return
      close()
      callbacks.current.onError(error.message)
      callbacks.current.onCancel()
    })
    return () => {
      disposed = true
      close()
    }
  }, [
    open,
    dialogId,
    title,
    message,
    detail,
    confirmText,
    cancelText,
    danger,
    checkboxLabel,
    checkboxHelp
  ])

  return null
}
