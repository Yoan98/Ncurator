import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Empty, Select, Spin, Tooltip } from 'antd'
import {
  HiArrowUp,
  HiChevronDown,
  HiCpuChip,
  HiDocumentText,
  HiFolder,
  HiGlobeAlt,
  HiMagnifyingGlass,
  HiSparkles,
  HiStop
} from 'react-icons/hi2'
import type {
  LLMConfig,
  LlmRemoteModel,
  ReferenceKind,
  SelectedReference,
  WorkspaceSource
} from '../../../../shared/types'
import { workbenchSelectors } from '../../testing/selectors'
import type { WorkbenchContextUsage, WorkbenchMode } from './types'
import { COMPOSER_PLACEHOLDER, COMPOSER_REFERENCE_KINDS } from './composer/constants'
import type { ComposerDraftValue, ComposerNode } from './composer/types'
import {
  createScopeTokenElement,
  extractComposerDraftValue,
  getScopeKey,
  moveCaretToEnd,
  moveCaretToTextNode,
  pruneComposerNodesByWorkspace,
  readComposerNodesFromEditor,
  renderComposerNodesToEditor
} from './composer/utils'
import {
  getKbAvailabilityLabel,
  getReferenceDisplayPath,
  getReferenceTypeLabel
} from '../../utils/reference'

type MentionContext = {
  textNode: Text
  caretOffset: number
  triggerIndex: number
  query: string
}

type WorkbenchComposerProps = {
  mode: WorkbenchMode
  onModeChange: (mode: WorkbenchMode) => void
  activeModelConfig: LLMConfig | null
  remoteModels: LlmRemoteModel[]
  selectedModelName: string | null
  onModelNameChange: (modelName: string) => void
  workspaces: WorkspaceSource[]
  selectedWorkspaceId: string | null
  onWorkspaceChange: (workspaceId: string | null) => void
  onDraftChange: (draft: ComposerDraftValue) => void
  onSubmit: () => void
  onCancel: () => void
  loading: boolean
  cancelling?: boolean
  canSubmit: boolean
  showCancel: boolean
  resetKey: number
  contextUsage?: WorkbenchContextUsage | null
}

const isTextNode = (value: Node | null): value is Text => value instanceof Text
const CARET_ANCHOR_ROLE = 'composer-caret-anchor'
const areComposerNodesEqual = (left: ComposerNode[], right: ComposerNode[]): boolean =>
  left.length === right.length &&
  left.every((node, index) => {
    const peer = right[index]
    if (!peer || node.kind !== peer.kind) return false
    if (node.kind === 'text' && peer.kind === 'text') {
      return node.text === peer.text
    }
    if (node.kind === 'scope' && peer.kind === 'scope') {
      return getScopeKey(node.scope) === getScopeKey(peer.scope)
    }
    return false
  })

const WorkbenchComposer: React.FC<WorkbenchComposerProps> = ({
  mode,
  onModeChange,
  activeModelConfig,
  remoteModels,
  selectedModelName,
  onModelNameChange,
  workspaces,
  selectedWorkspaceId,
  onWorkspaceChange,
  onDraftChange,
  onSubmit,
  onCancel,
  loading,
  cancelling = false,
  canSubmit,
  showCancel,
  resetKey,
  contextUsage
}) => {
  const editorRef = useRef<HTMLSpanElement | null>(null)
  const draftNodesRef = useRef<ComposerNode[]>([])
  const knownScopesRef = useRef(new Map<string, SelectedReference>())
  const draftSyncFrameRef = useRef<number | null>(null)
  const mentionRefreshFrameRef = useRef<number | null>(null)
  const controlFocusTimeoutRef = useRef<number | null>(null)
  const isComposingRef = useRef(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionOptions, setMentionOptions] = useState<SelectedReference[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const [hasContent, setHasContent] = useState(false)

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) || null,
    [selectedWorkspaceId, workspaces]
  )

  const closeMention = useCallback(() => {
    setMentionQuery(null)
    setMentionOptions([])
    setMentionActiveIndex(0)
  }, [])

  const ensureEditorHasCaretTarget = useCallback((): void => {
    const editor = editorRef.current
    if (!editor) return
    const lastChild = editor.lastChild
    if (isTextNode(lastChild)) {
      return
    }
    if (lastChild instanceof HTMLBRElement && lastChild.dataset.role === CARET_ANCHOR_ROLE) {
      return
    }
    const anchor = document.createElement('br')
    anchor.dataset.role = CARET_ANCHOR_ROLE
    editor.appendChild(anchor)
  }, [])

  const stripCaretPlaceholderFromEditor = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.querySelectorAll(`br[data-role="${CARET_ANCHOR_ROLE}"]`).forEach((anchor) => {
      anchor.remove()
    })
  }, [])

  const restoreCaretToEnd = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const selection = window.getSelection()
    if (
      selection?.rangeCount &&
      selection.isCollapsed &&
      isTextNode(selection.anchorNode) &&
      editor.contains(selection.anchorNode)
    ) {
      return
    }

    ensureEditorHasCaretTarget()
    moveCaretToEnd(editor)
  }, [ensureEditorHasCaretTarget])

  const focusEditor = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    restoreCaretToEnd()
  }, [restoreCaretToEnd])

  const focusEditorAfterControlChange = useCallback(() => {
    if (controlFocusTimeoutRef.current !== null) {
      window.clearTimeout(controlFocusTimeoutRef.current)
    }
    window.requestAnimationFrame(() => {
      controlFocusTimeoutRef.current = window.setTimeout(() => {
        const activeElement = document.activeElement
        if (
          activeElement instanceof HTMLElement &&
          activeElement !== editorRef.current &&
          !editorRef.current?.contains(activeElement)
        ) {
          activeElement.blur()
        }
        focusEditor()
        controlFocusTimeoutRef.current = null
      }, 80)
    })
  }, [focusEditor])

  const syncDraftFromEditor = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    stripCaretPlaceholderFromEditor()
    const nodes = readComposerNodesFromEditor(editor, knownScopesRef.current)
    draftNodesRef.current = nodes
    setHasContent(nodes.length > 0)
    const draft = extractComposerDraftValue(nodes)
    draft.selectedReferences.forEach((scope) => {
      knownScopesRef.current.set(getScopeKey(scope), scope)
    })
    onDraftChange(draft)
  }, [onDraftChange, stripCaretPlaceholderFromEditor])

  const scheduleDraftSyncFromEditor = useCallback(() => {
    if (draftSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(draftSyncFrameRef.current)
    }
    draftSyncFrameRef.current = window.requestAnimationFrame(() => {
      draftSyncFrameRef.current = null
      syncDraftFromEditor()
    })
  }, [syncDraftFromEditor])

  const getMentionContext = useCallback((): MentionContext | null => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection || !selection.rangeCount || !selection.isCollapsed) return null

    const anchorNode = selection.anchorNode
    let textNode: Text | null = null
    let caretOffset = selection.anchorOffset

    if (isTextNode(anchorNode) && editor.contains(anchorNode)) {
      textNode = anchorNode
    } else if (anchorNode === editor) {
      const previousChild =
        selection.anchorOffset > 0 ? editor.childNodes[selection.anchorOffset - 1] : null
      const nextChild = editor.childNodes[selection.anchorOffset] || null
      if (isTextNode(previousChild)) {
        textNode = previousChild
        caretOffset = previousChild.data.length
      } else if (isTextNode(nextChild)) {
        textNode = nextChild
        caretOffset = 0
      }
    } else if (anchorNode instanceof HTMLElement && editor.contains(anchorNode)) {
      const previousChild = anchorNode.childNodes[Math.max(0, selection.anchorOffset - 1)] || null
      const nextChild = anchorNode.childNodes[selection.anchorOffset] || null
      if (isTextNode(previousChild)) {
        textNode = previousChild
        caretOffset = previousChild.data.length
      } else if (isTextNode(nextChild)) {
        textNode = nextChild
        caretOffset = 0
      }
    }

    if (!textNode) return null

    const beforeCaret = textNode.data.slice(0, caretOffset)
    const triggerIndex = beforeCaret.lastIndexOf('@')
    if (triggerIndex < 0) return null

    const query = beforeCaret.slice(triggerIndex + 1)
    if (/\s/.test(query)) return null

    const previousChar = triggerIndex > 0 ? beforeCaret.charAt(triggerIndex - 1) : ''
    if (previousChar && !/[\s([{,，。；;、]/.test(previousChar)) return null

    return {
      textNode,
      caretOffset,
      triggerIndex,
      query
    }
  }, [])

  const refreshMentionContext = useCallback(() => {
    const context = getMentionContext()
    if (!context) {
      closeMention()
      return
    }
    setMentionQuery(context.query)
    setMentionActiveIndex(0)
  }, [closeMention, getMentionContext])

  const scheduleMentionRefresh = useCallback(() => {
    if (mentionRefreshFrameRef.current !== null) {
      window.cancelAnimationFrame(mentionRefreshFrameRef.current)
    }
    mentionRefreshFrameRef.current = window.requestAnimationFrame(() => {
      mentionRefreshFrameRef.current = null
      refreshMentionContext()
    })
  }, [refreshMentionContext])

  const insertTextAtSelection = useCallback(
    (text: string) => {
      const editor = editorRef.current
      if (!editor) return

      let selection = window.getSelection()
      if (!selection || !selection.rangeCount) {
        focusEditor()
        selection = window.getSelection()
      }
      if (!selection || !selection.rangeCount) return

      const range = selection.getRangeAt(0)
      if (!editor.contains(range.commonAncestorContainer)) {
        focusEditor()
      }

      const nextSelection = window.getSelection()
      if (!nextSelection || !nextSelection.rangeCount) return
      const nextRange = nextSelection.getRangeAt(0)
      nextRange.deleteContents()
      const startContainer = nextRange.startContainer
      if (isTextNode(startContainer)) {
        const insertOffset = nextRange.startOffset
        startContainer.data = `${startContainer.data.slice(0, insertOffset)}${text}${startContainer.data.slice(insertOffset)}`
        moveCaretToTextNode(startContainer, insertOffset + text.length)
      } else {
        const textNode = document.createTextNode(text)
        nextRange.insertNode(textNode)
        moveCaretToTextNode(textNode, text.length)
      }
      editor.normalize()
      syncDraftFromEditor()
      refreshMentionContext()
    },
    [refreshMentionContext, syncDraftFromEditor]
  )

  const insertMentionScope = useCallback(
    (scope: SelectedReference) => {
      const editor = editorRef.current
      const context = getMentionContext()
      if (!editor || !context) return

      knownScopesRef.current.set(getScopeKey(scope), scope)

      const before = context.textNode.data.slice(0, context.triggerIndex)
      const after = context.textNode.data.slice(context.caretOffset)
      const parent = context.textNode.parentNode
      if (!parent) return

      const nodes: Node[] = []
      if (before) {
        nodes.push(document.createTextNode(before))
      }

      nodes.push(createScopeTokenElement(scope))

      const tailText = after.startsWith(' ') || !after ? `${after}` : ` ${after}`
      const trailingTextNode = document.createTextNode(tailText || ' ')
      nodes.push(trailingTextNode)

      nodes.forEach((node) => parent.insertBefore(node, context.textNode))
      parent.removeChild(context.textNode)

      moveCaretToTextNode(trailingTextNode, Math.min(1, trailingTextNode.data.length))
      closeMention()
      syncDraftFromEditor()
    },
    [closeMention, getMentionContext, syncDraftFromEditor]
  )

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    draftNodesRef.current = []
    renderComposerNodesToEditor(editor, [])
    ensureEditorHasCaretTarget()
    setHasContent(false)
    onDraftChange({ input: '', selectedReferences: [] })
    closeMention()
  }, [closeMention, ensureEditorHasCaretTarget, onDraftChange, resetKey])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const currentNodes = readComposerNodesFromEditor(editor, knownScopesRef.current)
    const nextNodes = pruneComposerNodesByWorkspace(currentNodes, selectedWorkspaceId)
    if (nextNodes.length === currentNodes.length) return
    draftNodesRef.current = nextNodes
    renderComposerNodesToEditor(editor, nextNodes)
    if (document.activeElement === editor) {
      restoreCaretToEnd()
    }
    syncDraftFromEditor()
    closeMention()
  }, [closeMention, restoreCaretToEnd, selectedWorkspaceId, syncDraftFromEditor])

  useEffect(() => {
    if (mentionQuery === null) return
    let cancelled = false

    const loadMentionOptions = async (): Promise<void> => {
      if (!selectedWorkspaceId || !selectedWorkspaceId.trim()) {
        if (!cancelled) {
          setMentionOptions([])
          setMentionActiveIndex(0)
          setMentionLoading(false)
        }
        return
      }

      setMentionLoading(true)
      try {
        const referenceKinds: ReferenceKind[] = COMPOSER_REFERENCE_KINDS
        const response = await window.api.referenceItemList({
          mode: mode === 'ai' ? 'chat' : 'search',
          query: mentionQuery.trim() || undefined,
          workspaceId: selectedWorkspaceId,
          referenceKinds
        })

        const editor = editorRef.current
        const currentKeys = new Set<string>()
        if (editor) {
          const draft = extractComposerDraftValue(
            readComposerNodesFromEditor(editor, knownScopesRef.current)
          )
          draft.selectedReferences.forEach((scope) => currentKeys.add(getScopeKey(scope)))
        }

        const nextOptions = response.items.filter((scope) => !currentKeys.has(getScopeKey(scope)))
        nextOptions.forEach((scope) => {
          knownScopesRef.current.set(getScopeKey(scope), scope)
        })

        if (!cancelled) {
          setMentionOptions(nextOptions)
          setMentionActiveIndex(0)
        }
      } finally {
        if (!cancelled) setMentionLoading(false)
      }
    }

    void loadMentionOptions()
    return () => {
      cancelled = true
    }
  }, [mentionQuery, mode, selectedWorkspaceId])

  useEffect(() => {
    const handleSelectionChange = (): void => {
      if (isComposingRef.current) return
      const editor = editorRef.current
      const selection = window.getSelection()
      if (!editor || !selection) return
      if (selection.anchorNode !== editor && !editor.contains(selection.anchorNode)) return
      refreshMentionContext()
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      if (mentionRefreshFrameRef.current !== null) {
        window.cancelAnimationFrame(mentionRefreshFrameRef.current)
      }
      if (draftSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(draftSyncFrameRef.current)
      }
      if (controlFocusTimeoutRef.current !== null) {
        window.clearTimeout(controlFocusTimeoutRef.current)
      }
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [refreshMentionContext])

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (isComposingRef.current) return
    const expectedNodes = draftNodesRef.current
    const currentNodes = readComposerNodesFromEditor(editor, knownScopesRef.current)
    if (areComposerNodesEqual(currentNodes, expectedNodes)) return
    const shouldRestoreCaret = document.activeElement === editor
    renderComposerNodesToEditor(editor, expectedNodes)
    if (shouldRestoreCaret) {
      moveCaretToEnd(editor)
    }
  })

  const handleEditorInput = (): void => {
    if (isComposingRef.current) {
      const editor = editorRef.current
      const hasText = Boolean(editor?.textContent?.trim())
      const hasScopeToken = Boolean(editor?.querySelector('[data-role="scope-token"]'))
      setHasContent(hasText || hasScopeToken)
      return
    }
    scheduleDraftSyncFromEditor()
    scheduleMentionRefresh()
  }

  const handleEditorFocus = (): void => {
    restoreCaretToEnd()
  }

  const handleEditorMouseUp = (): void => {
    restoreCaretToEnd()
  }

  const handleEditorPaste = (event: React.ClipboardEvent<HTMLSpanElement>): void => {
    event.preventDefault()
    const pastedText = event.clipboardData.getData('text/plain')
    if (!pastedText) return
    insertTextAtSelection(pastedText)
  }

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (event.nativeEvent.isComposing || isComposingRef.current) return

    if (mentionQuery !== null) {
      if (event.key === 'ArrowDown' && mentionOptions.length > 0) {
        event.preventDefault()
        setMentionActiveIndex((current) => (current + 1) % mentionOptions.length)
        return
      }
      if (event.key === 'ArrowUp' && mentionOptions.length > 0) {
        event.preventDefault()
        setMentionActiveIndex((current) =>
          current === 0 ? mentionOptions.length - 1 : current - 1
        )
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const nextOption = mentionOptions[mentionActiveIndex]
        if (nextOption) {
          insertMentionScope(nextOption)
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMention()
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSubmit()
      return
    }

    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      insertTextAtSelection('\n')
      return
    }

    if (event.key !== 'Backspace') return

    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection || !selection.rangeCount || !selection.isCollapsed) return

    const anchorNode = selection.anchorNode
    let previousNode: ChildNode | null = null
    if (isTextNode(anchorNode) && selection.anchorOffset === 0) {
      previousNode = anchorNode.previousSibling
    } else if (anchorNode === editor && selection.anchorOffset > 0) {
      previousNode = editor.childNodes[selection.anchorOffset - 1] || null
    }

    if (!(previousNode instanceof HTMLElement) || previousNode.dataset.role !== 'scope-token')
      return
    event.preventDefault()
    previousNode.remove()
    focusEditor()
    syncDraftFromEditor()
    closeMention()
  }

  const handleEditorClickCapture = (event: React.MouseEvent<HTMLSpanElement>): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const removeButton = target.closest('[data-action="remove-scope-token"]')
    if (!removeButton) return
    event.preventDefault()
    const token = removeButton.closest('[data-role="scope-token"]')
    if (!(token instanceof HTMLElement)) return
    token.remove()
    focusEditor()
    syncDraftFromEditor()
    closeMention()
  }

  const localMentionOptions = mentionOptions.filter((scope) => scope.kind !== 'web')
  const webMentionOptions = mentionOptions.filter((scope) => scope.kind === 'web')
  const contextUsagePercent = Math.max(0, Math.min(100, Math.round((contextUsage?.ratio || 0) * 100)))
  const contextUsageTitle = contextUsage
    ? `当前上下文约 ${contextUsage.usedContextTokens.toLocaleString()} / ${contextUsage.contextWindowTokens.toLocaleString()} tokens`
    : '暂无上下文用量'

  return (
    <div className="relative">
      {mentionQuery !== null ? (
        <div
          className="absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-[24px] border border-[#CBC7BD] bg-white shadow-[0_18px_44px_rgba(31,31,31,0.08)]"
          data-testid={workbenchSelectors.mentionPanel}
        >
          <div className="max-h-[300px] overflow-y-auto px-2.5 py-2.5">
            {mentionLoading ? (
              <div className="flex items-center justify-center py-8 text-[#9C9A94]">
                <Spin size="small" />
              </div>
            ) : mentionOptions.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={selectedWorkspace ? '当前工作区和网页资料中没有匹配项' : '请先选择工作区'}
              />
            ) : (
              <div className="space-y-3">
                {localMentionOptions.length > 0 ? (
                  <div className="space-y-1">
                    <div className="px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#9C9A94]">
                      当前工作区
                    </div>
                    {localMentionOptions.map((scope) => {
                      const optionIndex = mentionOptions.findIndex(
                        (option) => getScopeKey(option) === getScopeKey(scope)
                      )
                      const active = mentionActiveIndex === optionIndex
                      return (
                        <button
                          key={getScopeKey(scope)}
                          type="button"
                          className={`flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition ${
                            active ? 'bg-[#F0EFEB]' : 'hover:bg-[#FAF6F1]'
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault()
                            insertMentionScope(scope)
                          }}
                        >
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-[10px] ${
                              scope.kind === 'directory'
                                ? 'bg-[#F0EFEB] text-[#6E6D69]'
                                : 'bg-[#F0EFEB] text-[#6E6D69]'
                            }`}
                          >
                            {scope.kind === 'directory' ? (
                              <HiFolder className="h-4 w-4" />
                            ) : (
                              <HiDocumentText className="h-4 w-4" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-medium leading-6 text-[#181818]">
                              {scope.name}
                            </div>
                            <div className="truncate text-[12px] leading-5 text-[#9C9A94]">
                              {getReferenceDisplayPath(scope)}
                            </div>
                          </div>
                          <div className="shrink-0 space-x-1">
                            <span className="rounded-full border border-[#E1DED6] bg-[#F8F8F7] px-2 py-0.5 text-[11px] text-[#6E6D69]">
                              {getReferenceTypeLabel(scope)}
                            </span>
                            <span className="rounded-full border border-[#E1DED6] bg-[#F0EFEB] px-2 py-0.5 text-[11px] text-[#181818]">
                              {getKbAvailabilityLabel(scope.kbAvailability)}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : null}

                {webMentionOptions.length > 0 ? (
                  <div className="space-y-1">
                    <div className="px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#9C9A94]">
                      网页资料
                    </div>
                    {webMentionOptions.map((scope) => {
                      const optionIndex = mentionOptions.findIndex(
                        (option) => getScopeKey(option) === getScopeKey(scope)
                      )
                      const active = mentionActiveIndex === optionIndex
                      return (
                        <button
                          key={getScopeKey(scope)}
                          type="button"
                          className={`flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition ${
                            active ? 'bg-[#F0EFEB]' : 'hover:bg-[#FAF6F1]'
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault()
                            insertMentionScope(scope)
                          }}
                        >
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] bg-[#F0EFEB] text-[#6E6D69]">
                            <HiGlobeAlt className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-medium leading-6 text-[#181818]">
                              {scope.name}
                            </div>
                            <div className="truncate text-[12px] leading-5 text-[#9C9A94]">
                              {getReferenceDisplayPath(scope)}
                            </div>
                          </div>
                          <div className="shrink-0 space-x-1">
                            <span className="rounded-full border border-[#E1DED6] bg-[#F8F8F7] px-2 py-0.5 text-[11px] text-[#6E6D69]">
                              {getReferenceTypeLabel(scope)}
                            </span>
                            <span className="rounded-full border border-[#E1DED6] bg-[#F0EFEB] px-2 py-0.5 text-[11px] text-[#181818]">
                              {getKbAvailabilityLabel(scope.kbAvailability)}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div
        className="rounded-[24px] border border-[#CBC7BD] bg-white px-3.5 pb-2 pt-2.5 shadow-[0_8px_24px_rgba(31,31,31,0.06)] transition-all duration-200 focus-within:border-[#181818] focus-within:ring-4 focus-within:ring-[#E1DED6]"
        data-testid={workbenchSelectors.referenceField}
        onMouseDown={(event) => {
          const target = event.target
          if (!(target instanceof HTMLElement)) return
          if (target.closest('[contenteditable="true"]')) return
          if (target.closest('button') || target.closest('.ant-select')) return
          event.preventDefault()
          focusEditor()
        }}
      >
        <div className="relative min-h-[58px]">
          <span
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            tabIndex={0}
            spellCheck={false}
            className="block min-h-[40px] w-full whitespace-pre-wrap break-words bg-transparent text-[15px] leading-6 text-[#181818] outline-none [&_[data-role='scope-token']]:align-middle"
            data-testid={workbenchSelectors.input}
            onInput={handleEditorInput}
            onKeyDown={handleEditorKeyDown}
            onPaste={handleEditorPaste}
            onClickCapture={handleEditorClickCapture}
            onFocus={handleEditorFocus}
            onMouseUp={handleEditorMouseUp}
            onKeyUp={() => {
              if (isComposingRef.current) return
              scheduleMentionRefresh()
            }}
            onCompositionStart={() => {
              isComposingRef.current = true
              if (draftSyncFrameRef.current !== null) {
                window.cancelAnimationFrame(draftSyncFrameRef.current)
                draftSyncFrameRef.current = null
              }
              if (mentionRefreshFrameRef.current !== null) {
                window.cancelAnimationFrame(mentionRefreshFrameRef.current)
                mentionRefreshFrameRef.current = null
              }
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false
              scheduleDraftSyncFromEditor()
              scheduleMentionRefresh()
            }}
          />

          <div
            className={`pointer-events-none absolute inset-x-0 top-0 text-[15px] leading-6 text-[#9C9A94] ${
              hasContent ? 'hidden' : ''
            }`}
          >
            {COMPOSER_PLACEHOLDER}
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-[#E1DED6] pt-1.5">
          <div className="flex min-w-0 items-center gap-1.5 text-[#6E6D69]">
            <Select
              value={mode}
              onChange={(nextValue) => {
                onModeChange(nextValue as WorkbenchMode)
                focusEditorAfterControlChange()
              }}
              variant="borderless"
              suffixIcon={<HiChevronDown className="h-3.5 w-3.5 text-[#9C9A94]" />}
              options={[
                {
                  value: 'ai',
                  label: (
                    <span className="flex items-center gap-1.5 text-[12px]">
                      <HiSparkles className="h-3.5 w-3.5" />
                      <span>大聪明</span>
                    </span>
                  )
                },
                {
                  value: 'search',
                  label: (
                    <span className="flex items-center gap-1.5 text-[12px]">
                      <HiMagnifyingGlass className="h-3.5 w-3.5" />
                      <span>没头脑</span>
                    </span>
                  )
                }
              ]}
              popupClassName="workbench-composer-select-dropdown"
              className="workbench-composer-select min-w-[72px]"
              data-testid={workbenchSelectors.modeSwitch}
            />

            <Select
              value={selectedModelName || undefined}
              onChange={(nextValue) => {
                onModelNameChange(String(nextValue))
                focusEditorAfterControlChange()
              }}
              showSearch
              filterOption={(inputValue, option) => {
                const normalizedInput = inputValue.trim().toLowerCase()
                if (!normalizedInput) return true
                const label = String(option?.title || option?.value || '')
                return (
                  label.toLowerCase().includes(normalizedInput) ||
                  String(option?.value || '').toLowerCase().includes(normalizedInput)
                )
              }}
              variant="borderless"
              suffixIcon={<HiChevronDown className="h-3.5 w-3.5 text-[#9C9A94]" />}
              optionLabelProp="label"
              popupClassName="workbench-composer-select-dropdown"
              className="workbench-composer-select min-w-[132px]"
              options={remoteModels.map((model) => ({
                value: model.id,
                label: (
                  <span className="flex min-w-0 items-center gap-1.5 text-[12px]">
                    <HiCpuChip className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{model.label || model.id}</span>
                  </span>
                ),
                title: activeModelConfig
                  ? `${activeModelConfig.base_url} · ${model.label || model.id} · ${model.id}`
                  : `${model.label || model.id} · ${model.id}`
              }))}
              placeholder={activeModelConfig ? '选择模型' : '模型'}
              data-testid={workbenchSelectors.modelSelect}
            />

            <Select
              value={selectedWorkspace?.id}
              onChange={(nextValue) => {
                onWorkspaceChange(nextValue ? String(nextValue) : null)
                focusEditorAfterControlChange()
              }}
              variant="borderless"
              suffixIcon={<HiChevronDown className="h-3.5 w-3.5 text-[#9C9A94]" />}
              optionLabelProp="label"
              popupClassName="workbench-composer-select-dropdown"
              className="workbench-composer-select min-w-[132px]"
              options={workspaces.map((workspace) => ({
                value: workspace.id,
                label: (
                  <span className="flex min-w-0 items-center gap-1.5 text-[12px]">
                    <HiFolder className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{workspace.name}</span>
                  </span>
                ),
                title: workspace.root_path || '未设置文件目录'
              }))}
              placeholder="工作区"
              data-testid={workbenchSelectors.workspaceSelect}
            />
          </div>

          <div className="flex items-center gap-2">
            {mode === 'ai' ? (
              <Tooltip title={contextUsageTitle}>
                <div
                  className="relative inline-flex h-7 w-7 items-center justify-center rounded-full text-[9px] font-medium text-[#6E6D69]"
                  aria-label={contextUsageTitle}
                >
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: `conic-gradient(#181818 ${contextUsagePercent}%, #E8E6DF ${contextUsagePercent}% 100%)`
                    }}
                  />
                  <div className="absolute inset-[3px] rounded-full bg-white" />
                  <span className="relative">{contextUsagePercent}%</span>
                </div>
              </Tooltip>
            ) : null}
            <button
              type="button"
              onClick={showCancel ? onCancel : onSubmit}
              disabled={showCancel ? cancelling : loading || !canSubmit}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-white transition ${
                showCancel
                  ? cancelling
                    ? 'bg-[#CBC7BD]'
                    : 'bg-[#A83A31] shadow-[0_6px_14px_rgba(181,69,93,0.16)] hover:-translate-y-[1px] hover:bg-[#8F3028]'
                  : loading || !canSubmit
                  ? 'bg-[#CBC7BD]'
                  : 'bg-[#181818] shadow-[0_6px_14px_rgba(24,24,24,0.14)] hover:-translate-y-[1px] hover:bg-[#3F3F3D]'
              }`}
              data-testid={workbenchSelectors.sendButton}
              aria-label={showCancel ? '停止本次运行' : mode === 'ai' ? '发送智能请求' : '执行搜索'}
            >
              {showCancel ? (
                cancelling ? (
                  <Spin size="small" />
                ) : (
                  <HiStop className="h-4 w-4" />
                )
              ) : loading ? (
                <Spin size="small" />
              ) : (
                <HiArrowUp className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default WorkbenchComposer
