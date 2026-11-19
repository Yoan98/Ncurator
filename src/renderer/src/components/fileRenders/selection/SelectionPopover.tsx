import { t } from '../../../i18n'
import { createPortal } from 'react-dom'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { HiOutlineCheck, HiOutlineSparkles, HiOutlineTrash } from 'react-icons/hi2'
import type { ChatInlineContentNode } from '../../../../../shared/types'
import { chatContentText, chatReferences, hasUserText } from '../../../../../shared/chatContent'
import ComposerInputEditor from '../../workbench/composer/ComposerInputEditor'
import type { SelectionFloatingPosition } from './floatingLayout'
import type { SelectionPopup } from './types'

export default function SelectionPopover({
  popup,
  setPopup,
  popupRef,
  floating,
  locked,
  save,
  remove,
  maxWidth,
  testPrefix
}: {
  popup: SelectionPopup
  setPopup: Dispatch<SetStateAction<SelectionPopup | null>>
  popupRef: RefObject<HTMLDivElement | null>
  floating: SelectionFloatingPosition | null
  locked: boolean
  save: () => void
  remove: (id: string) => void
  maxWidth: number
  testPrefix: string
}) {
  return createPortal(
    <div
      ref={popupRef}
      data-testid={`${testPrefix}-selection-popup`}
      data-placement={floating?.placement}
      className={
        'fixed z-[1100] border border-[var(--notion-line-strong)] bg-[var(--notion-page)] shadow-[0_4px_16px_rgba(15,15,15,0.10)] ' +
        (popup.mode === 'editor'
          ? 'flex w-[420px] items-end gap-1 rounded-[19px] p-[4px] focus-within:border-[var(--notion-blue)]'
          : 'rounded-lg p-1')
      }
      style={{
        left: floating?.left,
        top: floating?.top,
        maxWidth: maxWidth,
        visibility: floating ? 'visible' : 'hidden'
      }}
    >
      {popup.mode === 'action' ? (
        <button
          type="button"
          data-testid={`${testPrefix}-selection-ai-reference`}
          disabled={locked}
          className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-[var(--notion-text)] outline-none hover:bg-[var(--notion-surface)] focus-visible:ring-2 focus-visible:ring-[var(--notion-accent-blue)] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => setPopup((previous) => previous && { ...previous, mode: 'editor' })}
        >
          <HiOutlineSparkles className="h-4 w-4 text-[var(--notion-purple)]" aria-hidden="true" />
          {t(($) => $.editors.aiReference)}
        </button>
      ) : (
        <>
          <ComposerInputEditor
            value={{
              contentNodes: popup.node.children,
              input: chatContentText(popup.node.children),
              selectedReferences: chatReferences(popup.node.children)
            }}
            variant="inline"
            placeholder={t(($) => $.editors.describeWhatYouWantToDoWithThisContent)}
            dataTestId={`${testPrefix}-selection-thought`}
            disabled={locked}
            onSubmit={save}
            editorClassName="max-h-[68px] overflow-auto"
            onChange={(value) =>
              setPopup(
                (previous) =>
                  previous && {
                    ...previous,
                    node: {
                      ...previous.node,
                      children: value.contentNodes.filter(
                        (node): node is ChatInlineContentNode => node.kind !== 'document_selection'
                      )
                    }
                  }
              )
            }
          />
          {popup.node.number ? (
            <button
              type="button"
              aria-label={t(($) => $.editors.removeReference)}
              title={t(($) => $.editors.removeReference)}
              disabled={locked}
              className="flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--notion-text-faint)] outline-none hover:bg-[var(--notion-red-bg)] hover:text-[var(--notion-red)] focus-visible:ring-2 focus-visible:ring-[var(--notion-accent-blue)] disabled:cursor-not-allowed"
              onClick={() => {
                remove(popup.node.id)
                setPopup(null)
              }}
            >
              <HiOutlineTrash className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            data-testid={`${testPrefix}-selection-save`}
            aria-label={
              popup.node.number
                ? t(($) => $.editors.confirmChanges)
                : t(($) => $.editors.addToInput)
            }
            title={
              popup.node.number
                ? t(($) => $.editors.confirmChanges)
                : t(($) => $.editors.addToInput)
            }
            disabled={locked || !hasUserText(popup.node.children)}
            className="flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--notion-accent)] text-[var(--notion-accent-contrast)] outline-none hover:bg-[var(--notion-accent)] focus-visible:ring-2 focus-visible:ring-[var(--notion-accent-blue)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--notion-surface)] disabled:text-[var(--notion-text-faint)]"
            onClick={save}
          >
            <HiOutlineCheck className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </>
      )}
    </div>,
    document.body
  )
}
