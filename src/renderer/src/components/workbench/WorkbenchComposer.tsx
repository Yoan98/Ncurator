import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Select, Spin, Tooltip } from 'antd'
import {
  HiArrowUp,
  HiChevronDown,
  HiDocumentText,
  HiFolder,
  HiGlobeAlt,
  HiMagnifyingGlass,
  HiMicrophone,
  HiPlus,
  HiSparkles
} from 'react-icons/hi2'
import type { LLMConfig, SourceScopeSelection, WorkspaceSource } from '../../../../shared/types'
import { workbenchSelectors } from '../../testing/selectors'
import type { WorkbenchMode } from './types'
import { COMPOSER_PLACEHOLDER, COMPOSER_SCOPE_TYPES } from './composer/constants'
import type { ComposerDraftValue } from './composer/types'
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

type MentionContext = {
  textNode: Text
  caretOffset: number
  triggerIndex: number
  query: string
}

type WorkbenchComposerProps = {
  mode: WorkbenchMode
  onModeChange: (mode: WorkbenchMode) => void
  modelConfigs: LLMConfig[]
  selectedModelConfigId: string | null
  onModelConfigChange: (configId: string) => void
  workspaces: WorkspaceSource[]
  selectedWorkspaceId: string | null
  onWorkspaceChange: (workspaceId: string | null) => void
  onDraftChange: (draft: ComposerDraftValue) => void
  onSubmit: () => void
  onCancel: () => void
  loading: boolean
  canSubmit: boolean
  showCancel: boolean
  resetKey: number
}

const isTextNode = (value: Node | null): value is Text => value instanceof Text

const WorkbenchComposer: React.FC<WorkbenchComposerProps> = ({
  mode,
  onModeChange,
  modelConfigs,
  selectedModelConfigId,
  onModelConfigChange,
  workspaces,
  selectedWorkspaceId,
  onWorkspaceChange,
  onDraftChange,
  onSubmit,
  onCancel,
  loading,
  canSubmit,
  showCancel,
  resetKey
}) => {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const knownScopesRef = useRef(new Map<string, SourceScopeSelection>())
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionOptions, setMentionOptions] = useState<SourceScopeSelection[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const [hasContent, setHasContent] = useState(false)

  const selectedModel = useMemo(
    () =>
      modelConfigs.find((config) => config.id === selectedModelConfigId) ||
      modelConfigs.find((config) => config.is_active) ||
      null,
    [modelConfigs, selectedModelConfigId]
  )

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) || null,
    [selectedWorkspaceId, workspaces]
  )

  const closeMention = useCallback(() => {
    setMentionQuery(null)
    setMentionOptions([])
    setMentionActiveIndex(0)
  }, [])

  const syncDraftFromEditor = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const nodes = readComposerNodesFromEditor(editor, knownScopesRef.current)
    setHasContent(nodes.length > 0)
    const draft = extractComposerDraftValue(nodes)
    draft.selectedSourceScopes.forEach((scope) => {
      knownScopesRef.current.set(getScopeKey(scope), scope)
    })
    onDraftChange(draft)
  }, [onDraftChange])

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
      const previousChild = editor.childNodes[Math.max(0, selection.anchorOffset - 1)] || null
      if (isTextNode(previousChild)) {
        textNode = previousChild
        caretOffset = previousChild.data.length
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

  const insertTextAtSelection = useCallback((text: string) => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection || !selection.rangeCount) return

    const range = selection.getRangeAt(0)
    if (!editor.contains(range.commonAncestorContainer)) {
      moveCaretToEnd(editor)
    }

    const nextSelection = window.getSelection()
    if (!nextSelection || !nextSelection.rangeCount) return
    const nextRange = nextSelection.getRangeAt(0)
    nextRange.deleteContents()
    const textNode = document.createTextNode(text)
    nextRange.insertNode(textNode)
    moveCaretToTextNode(textNode, text.length)
    syncDraftFromEditor()
    refreshMentionContext()
  }, [refreshMentionContext, syncDraftFromEditor])

  const insertMentionScope = useCallback(
    (scope: SourceScopeSelection) => {
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
    renderComposerNodesToEditor(editor, [])
    setHasContent(false)
    onDraftChange({ input: '', selectedSourceScopes: [] })
    closeMention()
  }, [closeMention, onDraftChange, resetKey])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const currentNodes = readComposerNodesFromEditor(editor, knownScopesRef.current)
    const nextNodes = pruneComposerNodesByWorkspace(currentNodes, selectedWorkspaceId)
    if (nextNodes.length === currentNodes.length) return
    renderComposerNodesToEditor(editor, nextNodes)
    syncDraftFromEditor()
    closeMention()
  }, [closeMention, selectedWorkspaceId, syncDraftFromEditor])

  useEffect(() => {
    if (mentionQuery === null) return
    let cancelled = false

    const loadMentionOptions = async (): Promise<void> => {
      setMentionLoading(true)
      try {
        const scopeTypes: SourceScopeSelection['scopeType'][] =
          selectedWorkspaceId && selectedWorkspaceId.trim() ? COMPOSER_SCOPE_TYPES : ['web']
        const response = await window.api.sourceScopeList({
          mode: mode === 'ai' ? 'chat' : 'search',
          query: mentionQuery.trim() || undefined,
          workspaceId: selectedWorkspaceId || undefined,
          scopeTypes
        })

        const editor = editorRef.current
        const currentKeys = new Set<string>()
        if (editor) {
          const draft = extractComposerDraftValue(
            readComposerNodesFromEditor(editor, knownScopesRef.current)
          )
          draft.selectedSourceScopes.forEach((scope) => currentKeys.add(getScopeKey(scope)))
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
      const editor = editorRef.current
      const selection = window.getSelection()
      if (!editor || !selection) return
      if (selection.anchorNode !== editor && !editor.contains(selection.anchorNode)) return
      refreshMentionContext()
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [refreshMentionContext])

  const handleEditorInput = (): void => {
    syncDraftFromEditor()
    refreshMentionContext()
  }

  const handleEditorPaste = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const pastedText = event.clipboardData.getData('text/plain')
    if (!pastedText) return
    insertTextAtSelection(pastedText)
  }

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
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

    if (!(previousNode instanceof HTMLElement) || previousNode.dataset.role !== 'scope-token') return
    event.preventDefault()
    previousNode.remove()
    syncDraftFromEditor()
    closeMention()
  }

  const handleEditorClickCapture = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const removeButton = target.closest('[data-action="remove-scope-token"]')
    if (!removeButton) return
    event.preventDefault()
    const token = removeButton.closest('[data-role="scope-token"]')
    if (!(token instanceof HTMLElement)) return
    token.remove()
    syncDraftFromEditor()
    closeMention()
  }

  const handleInsertTrigger = (): void => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    const selection = window.getSelection()
    if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) {
      moveCaretToEnd(editor)
    }
    insertTextAtSelection('@')
  }

  const localMentionOptions = mentionOptions.filter((scope) => scope.sourceType === 'workspace')
  const webMentionOptions = mentionOptions.filter((scope) => scope.sourceType === 'web')

  return (
    <div className="relative">
      {mentionQuery !== null ? (
        <div
          className="absolute inset-x-0 bottom-full mb-3 overflow-hidden rounded-[28px] border border-[#E5E5E4] bg-white/98 shadow-[0_18px_50px_rgba(31,31,31,0.09)] backdrop-blur-sm"
          data-testid={workbenchSelectors.mentionPanel}
        >
          <div className="max-h-[320px] overflow-y-auto px-3 py-3">
            {mentionLoading ? (
              <div className="flex items-center justify-center py-10 text-[#999999]">
                <Spin size="small" />
              </div>
            ) : mentionOptions.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  selectedWorkspace
                    ? '当前工作区和网页资料中没有匹配项'
                    : '先选工作区，或直接搜索网页资料'
                }
              />
            ) : (
              <div className="space-y-3">
                {localMentionOptions.length > 0 ? (
                  <div className="space-y-1">
                    <div className="px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#999999]">
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
                          className={`flex w-full items-center gap-3 rounded-[20px] px-4 py-3 text-left transition ${
                            active ? 'bg-[#F3F1EF]' : 'hover:bg-[#F7F6F4]'
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault()
                            insertMentionScope(scope)
                          }}
                        >
                          <span
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-xl ${
                              scope.scopeType === 'directory'
                                ? 'bg-[#F8F3EC] text-[#8A5A2B]'
                                : 'bg-[#EEF4FF] text-[#3B82F6]'
                            }`}
                          >
                            {scope.scopeType === 'directory' ? (
                              <HiFolder className="h-4 w-4" />
                            ) : (
                              <HiDocumentText className="h-4 w-4" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[15px] font-medium text-[#1F1F1F]">
                              {scope.label}
                            </div>
                            <div className="truncate text-[13px] text-[#999999]">
                              {scope.relativePath || scope.absolutePath}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : null}

                {webMentionOptions.length > 0 ? (
                  <div className="space-y-1">
                    <div className="px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#999999]">
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
                          className={`flex w-full items-center gap-3 rounded-[20px] px-4 py-3 text-left transition ${
                            active ? 'bg-[#F3F1EF]' : 'hover:bg-[#F7F6F4]'
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault()
                            insertMentionScope(scope)
                          }}
                        >
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#EDF7F5] text-[#2F7D6B]">
                            <HiGlobeAlt className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[15px] font-medium text-[#1F1F1F]">
                              {scope.label}
                            </div>
                            <div className="truncate text-[13px] text-[#999999]">
                              {scope.absolutePath}
                            </div>
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
        className="rounded-[28px] border border-[#E5E5E4] bg-white/96 px-4 pb-4 pt-4 shadow-[0_12px_30px_rgba(31,31,31,0.08)] backdrop-blur-sm transition-all duration-200 focus-within:border-[#D97757] focus-within:ring-4 focus-within:ring-[#F4E5DF]"
        data-testid={workbenchSelectors.sourceScopeField}
      >
        <div className="relative min-h-[136px]">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            className="min-h-[92px] w-full whitespace-pre-wrap break-words bg-transparent text-[15px] leading-7 text-[#1F1F1F] outline-none [&_[data-role='scope-token']]:align-middle"
            data-testid={workbenchSelectors.input}
            onInput={handleEditorInput}
            onKeyDown={handleEditorKeyDown}
            onPaste={handleEditorPaste}
            onClickCapture={handleEditorClickCapture}
          />

          <div
            className={`pointer-events-none absolute inset-x-0 top-0 text-[15px] leading-7 text-[#B3B3B0] ${
              hasContent ? 'hidden' : ''
            }`}
          >
            {COMPOSER_PLACEHOLDER}
          </div>
        </div>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2 text-[#7B7B79]">
            <Tooltip title="插入资料">
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-[#F5F5F4] hover:text-[#1F1F1F]"
                aria-label="插入资料"
                onClick={handleInsertTrigger}
              >
                <HiPlus className="h-6 w-6" />
              </button>
            </Tooltip>

            <Select
              value={mode}
              onChange={(nextValue) => onModeChange(nextValue as WorkbenchMode)}
              variant="borderless"
              suffixIcon={<HiChevronDown className="h-4 w-4 text-[#7B7B79]" />}
              options={[
                {
                  value: 'ai',
                  label: (
                    <span className="flex items-center gap-2">
                      <HiSparkles className="h-4 w-4" />
                      <span>智能</span>
                    </span>
                  )
                },
                {
                  value: 'search',
                  label: (
                    <span className="flex items-center gap-2">
                      <HiMagnifyingGlass className="h-4 w-4" />
                      <span>搜索</span>
                    </span>
                  )
                }
              ]}
              className="min-w-[92px]"
              data-testid={workbenchSelectors.modeSwitch}
            />

            <Select
              value={selectedModel?.id}
              onChange={(nextValue) => onModelConfigChange(String(nextValue))}
              variant="borderless"
              suffixIcon={<HiChevronDown className="h-4 w-4 text-[#7B7B79]" />}
              optionLabelProp="label"
              className="min-w-[130px]"
              options={modelConfigs.map((config) => ({
                value: config.id,
                label: config.model_name,
                title: `${config.name} · ${config.model_name}`
              }))}
              placeholder="模型"
              data-testid={workbenchSelectors.modelSelect}
            />

            <Select
              value={selectedWorkspace?.id}
              onChange={(nextValue) => onWorkspaceChange(String(nextValue))}
              variant="borderless"
              suffixIcon={<HiChevronDown className="h-4 w-4 text-[#7B7B79]" />}
              optionLabelProp="label"
              className="min-w-[140px]"
              options={workspaces.map((workspace) => ({
                value: workspace.id,
                label: workspace.name,
                title: workspace.root_path
              }))}
              placeholder="工作区"
              data-testid={workbenchSelectors.workspaceSelect}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#8B8B88] transition hover:bg-[#F5F5F4] hover:text-[#1F1F1F]"
              aria-label="语音输入"
            >
              <HiMicrophone className="h-5 w-5" />
            </button>
            {showCancel ? (
              <Button
                onClick={onCancel}
                className="border-[#E5E5E4] bg-white"
                data-testid={workbenchSelectors.cancelButton}
              >
                取消
              </Button>
            ) : null}
            <button
              type="button"
              onClick={onSubmit}
              disabled={loading || !canSubmit}
              className={`inline-flex h-14 w-14 items-center justify-center rounded-full text-white transition ${
                loading || !canSubmit ? 'bg-[#D8D8D6]' : 'bg-[#111111] hover:-translate-y-[1px]'
              }`}
              data-testid={workbenchSelectors.sendButton}
              aria-label={mode === 'ai' ? '发送智能请求' : '执行搜索'}
            >
              {loading ? <Spin size="small" /> : <HiArrowUp className="h-7 w-7" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default WorkbenchComposer
