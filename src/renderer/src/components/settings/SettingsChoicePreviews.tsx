import type { ReactNode } from 'react'

/**
 * 「界面主题 / 界面语言」卡片的缩略预览。
 * 这些色值是故意写死的：浅色卡在深色主题下也必须是白的，否则预览就失效了。
 */
const LIGHT_PREVIEW = '#FFFFFF'
const LIGHT_LINE = '#C9C7C1'
const LIGHT_LINE_SOFT = '#E7E5E1'
const DARK_PREVIEW = '#1B1B1B'
const DARK_LINE = '#5A5A5A'
const DARK_LINE_SOFT = '#3A3A3A'
const ACCENT = '#0B6BCB'

/** 三行文字线条 + 右下角标，用来暗示「一页内容」。 */
const ContentLines = ({
  x,
  y,
  width,
  color,
  soft
}: {
  x: number
  y: number
  width: number
  color: string
  soft: string
}): React.JSX.Element => (
  <>
    <rect x={x} y={y} width={width} height={2.4} rx={1.2} fill={color} />
    <rect x={x} y={y + 6} width={width * 0.7} height={2.4} rx={1.2} fill={soft} />
    <rect x={x} y={y + 12} width={width * 0.88} height={2.4} rx={1.2} fill={soft} />
    <circle cx={x + width - 3.5} cy={y + 21} r={3} fill={ACCENT} />
  </>
)

export const ThemePreviewLight = (): React.JSX.Element => (
  <svg viewBox="0 0 56 38" width="56" height="38" aria-hidden="true" focusable="false">
    <rect x="0.75" y="0.75" width="54.5" height="36.5" rx="5" fill={LIGHT_PREVIEW} stroke={LIGHT_LINE} />
    <ContentLines x={8} y={8} width={40} color={LIGHT_LINE} soft={LIGHT_LINE_SOFT} />
  </svg>
)

export const ThemePreviewDark = (): React.JSX.Element => (
  <svg viewBox="0 0 56 38" width="56" height="38" aria-hidden="true" focusable="false">
    <rect x="0.75" y="0.75" width="54.5" height="36.5" rx="5" fill={DARK_PREVIEW} stroke={DARK_LINE} />
    <ContentLines x={8} y={8} width={40} color={DARK_LINE} soft={DARK_LINE_SOFT} />
  </svg>
)

/**
 * 跟随系统：左浅右深对半，中央叠一枚半黑半白的「自动」圆环，
 * 让「跟着系统走」这层语义不用读文字也能看出来。
 */
export const ThemePreviewSystem = (): React.JSX.Element => (
  <svg viewBox="0 0 56 38" width="56" height="38" aria-hidden="true" focusable="false">
    <rect x="0.75" y="0.75" width="54.5" height="36.5" rx="5" fill={LIGHT_PREVIEW} stroke={LIGHT_LINE} />
    <path d="M28 0.75H50.25a5 5 0 0 1 5 5v26.5a5 5 0 0 1-5 5H28Z" fill={DARK_PREVIEW} />
    <line x1="28" y1="0.75" x2="28" y2="37.25" stroke={LIGHT_LINE} strokeWidth="1" />
    <ContentLines x={8} y={8} width={13} color={LIGHT_LINE} soft={LIGHT_LINE_SOFT} />
    <ContentLines x={34} y={8} width={13} color={DARK_LINE} soft={DARK_LINE_SOFT} />
    <circle cx="28" cy="19" r="8" fill={LIGHT_PREVIEW} stroke={DARK_PREVIEW} strokeWidth="1.6" />
    <path d="M28 11a8 8 0 0 1 0 16Z" fill={DARK_PREVIEW} />
  </svg>
)

const Glyph = ({ content }: { content: ReactNode }): React.JSX.Element => (
  <span className="nc-choice-glyph" aria-hidden="true">
    {content}
  </span>
)

export const LanguagePreviewSystem = (): React.JSX.Element => <Glyph content="AUTO" />
export const LanguagePreviewChinese = (): React.JSX.Element => <Glyph content="中" />
export const LanguagePreviewEnglish = (): React.JSX.Element => <Glyph content="EN" />
