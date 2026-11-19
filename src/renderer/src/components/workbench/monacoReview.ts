import { t } from '../../i18n'
import { getRendererRuntime } from '../../i18n'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js'
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js'
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js'
import 'monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution.js'
import 'monaco-editor/features/find/register.js'
import 'monaco-editor/editor/contrib/find/browser/findController.js'
import 'monaco-editor/editor/contrib/folding/browser/folding.js'
import 'monaco-editor/editor/contrib/lineSelection/browser/lineSelection.js'
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js'
import 'monaco-editor/editor/contrib/longLinesHelper/browser/longLinesHelper.js'
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js'
import 'monaco-editor/editor/contrib/readOnlyMessage/browser/contribution.js'
import 'monaco-editor/editor/contrib/tokenization/browser/tokenization.js'
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js'
import 'monaco-editor/editor/contrib/wordPartOperations/browser/wordPartOperations.js'
import 'monaco-editor/editor/browser/coreCommands.js'
import 'monaco-local/base/browser/ui/codicons/codicon/codicon.css'
import 'monaco-local/base/browser/ui/codicons/codicon/codicon-modifiers.css'
import 'monaco-editor/languages/definitions/markdown/register.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
// Message IDs belong to the pinned Monaco 0.57 locale. Keep review wording concise.
const messages = (globalThis as typeof globalThis & { _VSCODE_NLS_MESSAGES?: (string | null)[] })
  ._VSCODE_NLS_MESSAGES
if (messages && getRendererRuntime().locale === 'zh-CN')
  Object.assign(messages, {
    140: t(($) => $.workbench.message0LinesHidden),
    142: t(($) => $.workbench.expandUnchangedContent),
    144: t(($) => $.workbench.collapseUnchangedContent),
    145: t(($) => $.workbench.expand0UnchangedLines),
    146: t(($) => $.workbench.message0LinesHidden),
    147: t(($) => $.workbench.clickToExpand),
    148: t(($) => $.workbench.collapseUnchangedContent),
    154: t(($) => $.workbench.revertSelectedChanges),
    155: t(($) => $.workbench.revertThisChange2)
  })
const REVIEW_THEME_LIGHT = 'curator-review'
const REVIEW_THEME_DARK = 'curator-review-dark'

monaco.editor.defineTheme(REVIEW_THEME_LIGHT, {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#37352F',
    'diffEditor.insertedLineBackground': '#EDF6EF',
    'diffEditor.removedLineBackground': '#F8EBE9',
    'diffEditor.insertedTextBackground': '#A9D3B780',
    'diffEditor.removedTextBackground': '#E3B0AA80',
    'editorLineNumber.foreground': '#91918E'
  }
})

/** 暗色版本与 `--notion-*` 暗色 token 对齐，否则编辑器会成为页面里的一块亮斑。 */
monaco.editor.defineTheme(REVIEW_THEME_DARK, {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#191919',
    'editor.foreground': '#D4D4D4',
    'editorLineNumber.foreground': '#7A7A76',
    'editorLineNumber.activeForeground': '#D4D4D4',
    'editorGutter.background': '#191919',
    'editor.lineHighlightBackground': '#252525',
    'editor.selectionBackground': '#2F5F8F66',
    'editorCursor.foreground': '#5AA9F0',
    'editorIndentGuide.background1': '#2F2F2F',
    'editorWidget.background': '#252525',
    'editorWidget.border': '#2F2F2F',
    'editorHoverWidget.background': '#252525',
    'editorHoverWidget.border': '#2F2F2F',
    'scrollbarSlider.background': '#4A4A4A66',
    'scrollbarSlider.hoverBackground': '#5F5F5F99',
    'diffEditor.insertedLineBackground': '#1E2C24',
    'diffEditor.removedLineBackground': '#3A2422',
    'diffEditor.insertedTextBackground': '#7CC79B40',
    'diffEditor.removedTextBackground': '#FF9B9040'
  }
})

export type ReviewThemeName = typeof REVIEW_THEME_LIGHT | typeof REVIEW_THEME_DARK

/** Monaco 主题跟随页面 `data-theme`；切换时所有已创建的编辑器同步生效。 */
export const reviewThemeFor = (resolved: 'light' | 'dark'): ReviewThemeName =>
  resolved === 'dark' ? REVIEW_THEME_DARK : REVIEW_THEME_LIGHT

export const applyReviewTheme = (resolved: 'light' | 'dark'): void => {
  monaco.editor.setTheme(reviewThemeFor(resolved))
}

export { monaco }
