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
monaco.editor.defineTheme('curator-review', {
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
export { monaco }
