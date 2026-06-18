import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Spin } from 'antd'
import { HiArrowUp, HiCpuChip, HiMagnifyingGlass, HiSparkles, HiStop } from 'react-icons/hi2'
import type {
  LLMConfig,
  LlmRemoteModel,
  ReferenceKind,
  SelectedReference,
  WorkspaceSource
} from '../../../../shared/types'
import { workbenchSelectors } from '../../testing/selectors'
import type { WorkbenchContextUsage, WorkbenchMode, WorkbenchSelectOption } from './types'
import { COMPOSER_PLACEHOLDER, COMPOSER_REFERENCE_KINDS } from './composer/constants'
import ReferenceMentionPanel from './composer/ReferenceMentionPanel'
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
import WorkbenchSelect from './WorkbenchSelect'
import WorkspaceQuickSelect from './WorkspaceQuickSelect'

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
  onWorkspaceChange: (workspaceId: string) => void
  onWorkspaceEmptyAction?: () => void
  showWorkspaceSelector?: boolean
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
  onWorkspaceEmptyAction,
  showWorkspaceSelector = true,
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
    [focusEditor, refreshMentionContext, syncDraftFromEditor]
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

  const contextUsagePercent = Math.max(
    0,
    Math.min(100, Math.round((contextUsage?.ratio || 0) * 100))
  )
  const contextUsageTitle = contextUsage
    ? `当前上下文约 ${contextUsage.usedContextTokens.toLocaleString()} / ${contextUsage.contextWindowTokens.toLocaleString()} tokens`
    : '暂无上下文用量'
  const modeOptions = useMemo<WorkbenchSelectOption[]>(
    () => [
      {
        value: 'ai',
        label: 'AI',
        icon: <HiSparkles className="h-3.5 w-3.5" />
      },
      {
        value: 'search',
        label: '搜索',
        icon: <HiMagnifyingGlass className="h-3.5 w-3.5" />
      }
    ],
    []
  )
  const modelOptions = useMemo<WorkbenchSelectOption[]>(
    () =>
      remoteModels.map((model) => ({
        value: model.id,
        label: model.label || model.id,
        icon: <HiCpuChip className="h-3.5 w-3.5" />,
        description: activeModelConfig ? `${activeModelConfig.base_url} · ${model.id}` : model.id,
        keywords: [model.label || model.id, model.id, activeModelConfig?.base_url || '']
      })),
    [activeModelConfig, remoteModels]
  )

  return (
    <div className="relative">
      {mentionQuery !== null ? (
        <ReferenceMentionPanel
          loading={mentionLoading}
          options={mentionOptions}
          activeIndex={mentionActiveIndex}
          hasWorkspace={Boolean(selectedWorkspace)}
          onSelect={insertMentionScope}
        />
      ) : null}

      {showWorkspaceSelector ? (
        <div className="mb-2 flex min-w-0 items-center">
          <WorkspaceQuickSelect
            selectedWorkspaceId={selectedWorkspaceId}
            workspaces={workspaces}
            onWorkspaceChange={(nextValue) => {
              onWorkspaceChange(nextValue)
              focusEditorAfterControlChange()
            }}
            onEmptyAction={onWorkspaceEmptyAction}
            placeholder="选择工作空间"
            noDrag
            className="max-w-[190px]"
            data-testid={workbenchSelectors.workspaceSelect}
          />
        </div>
      ) : null}

      <div
        className="nc-floating-composer px-4 pb-2.5 pt-3 transition-all duration-200"
        data-testid={workbenchSelectors.referenceField}
        onMouseDown={(event) => {
          const target = event.target
          if (!(target instanceof HTMLElement)) return
          if (target.closest('[contenteditable="true"]')) return
          if (target.closest('button') || target.closest('[data-workbench-select-root="true"]')) {
            return
          }
          event.preventDefault()
          focusEditor()
        }}
      >
        <div className="relative min-h-[46px]">
          <span
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            tabIndex={0}
            spellCheck={false}
            className="block min-h-[32px] w-full whitespace-pre-wrap break-words bg-transparent text-[15px] leading-6 text-[#37352F] outline-none [&_[data-role='scope-token']]:align-middle"
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
          ></span>

          <div
            className={`pointer-events-none absolute inset-x-0 top-0 text-[15px] leading-6 text-[#91918E] ${
              hasContent ? 'hidden' : ''
            }`}
          >
            {COMPOSER_PLACEHOLDER}
          </div>
        </div>

        <div className="mx-[-4px] mt-1.5 flex items-center justify-between gap-2 px-1">
          <div className="flex shrink-0 items-center gap-1.5 text-[#91918E]">
            <WorkbenchSelect
              value={mode}
              options={modeOptions}
              onChange={(nextValue) => {
                onModeChange(nextValue as WorkbenchMode)
                focusEditorAfterControlChange()
              }}
              placeholder="模式"
              compact
              noDrag
              triggerClassName="workbench-composer-pill workbench-composer-mode-pill"
              menuClassName="workbench-composer-menu"
              data-testid={workbenchSelectors.modeSwitch}
            />
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <div
              className="workbench-context-ring relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
              aria-label={contextUsageTitle}
              title={contextUsageTitle}
            >
              <svg className="h-4 w-4 -rotate-90" viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="6.5" fill="none" stroke="#EEEEEC" strokeWidth="1.5" />
                <circle
                  cx="8"
                  cy="8"
                  r="6.5"
                  fill="none"
                  stroke="#91918E"
                  strokeWidth="1.5"
                  strokeDasharray={`${2 * Math.PI * 6.5}`}
                  strokeDashoffset={`${2 * Math.PI * 6.5 * (1 - contextUsagePercent / 100)}`}
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <WorkbenchSelect
              value={selectedModelName}
              options={modelOptions}
              onChange={(nextValue) => {
                onModelNameChange(nextValue)
                focusEditorAfterControlChange()
              }}
              placeholder={activeModelConfig ? '选择模型' : '模型'}
              triggerIcon={<HiCpuChip className="h-3.5 w-3.5" />}
              compact
              searchable
              searchPlaceholder="搜索模型"
              noDrag
              className="workbench-composer-model-select"
              triggerClassName="workbench-composer-pill workbench-composer-model-pill"
              menuClassName="workbench-composer-menu"
              selectedWithoutBackground
              data-testid={workbenchSelectors.modelSelect}
            />

            <button
              type="button"
              onClick={showCancel ? onCancel : onSubmit}
              disabled={showCancel ? cancelling : loading || !canSubmit}
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${
                showCancel
                  ? cancelling
                    ? 'bg-[#EEEEEC] text-[#91918E]'
                    : 'bg-[#B3261E] text-white hover:bg-[#8F3028]'
                  : loading || !canSubmit
                    ? 'bg-[#EEEEEC] text-[#91918E]'
                    : 'bg-[#37352F] text-white hover:bg-[#2F3437]'
              }`}
              data-testid={workbenchSelectors.sendButton}
              aria-label={showCancel ? '停止本次运行' : mode === 'ai' ? '发送智能请求' : '执行搜索'}
            >
              {showCancel ? (
                cancelling ? (
                  <Spin size="small" />
                ) : (
                  <HiStop className="h-3 w-3" />
                )
              ) : loading ? (
                <Spin size="small" />
              ) : (
                <HiArrowUp className="h-3 w-3" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default WorkbenchComposer
