import type { AppResolvedTheme } from '../../../shared/appPreferences'

/**
 * Palette for standalone documents loaded from `data:` URLs (native confirm dialog,
 * embedded-browser menus). They cannot read the renderer's CSS variables, so each value is
 * duplicated here — keep them in sync with the `--notion-*` tokens in `base.css`.
 */
export type OverlayPalette = {
  page: string
  text: string
  textSoft: string
  textFaint: string
  line: string
  lineStrong: string
  surface: string
  surfaceHover: string
  sunken: string
  accent: string
  accentText: string
  accentHover: string
  accentBlue: string
  red: string
  shadow: string
  shadowSoft: string
}

export const OVERLAY_PALETTE: Record<AppResolvedTheme, OverlayPalette> = {
  light: {
    page: '#ffffff',
    text: '#37352F',
    textSoft: '#787774',
    textFaint: '#91918E',
    line: '#EEEEEC',
    lineStrong: '#E0DFDC',
    surface: '#F4F4F2',
    surfaceHover: '#EFEFEE',
    sunken: '#F7F7F5',
    accent: '#2F3437',
    accentText: '#ffffff',
    accentHover: '#474C50',
    accentBlue: '#0B6BCB',
    red: '#B3261E',
    shadow: 'rgba(15, 15, 15, .12)',
    shadowSoft: 'rgba(15, 15, 15, .08)'
  },
  dark: {
    page: '#191919',
    text: '#D4D4D4',
    textSoft: '#9A9A97',
    textFaint: '#7A7A76',
    line: '#2F2F2F',
    lineStrong: '#3D3D3D',
    surface: '#252525',
    surfaceHover: '#2C2C2C',
    sunken: '#141414',
    accent: '#E6E6E6',
    accentText: '#1A1A1A',
    accentHover: '#F0F0F0',
    accentBlue: '#5AA9F0',
    red: '#FF9B90',
    shadow: 'rgba(0, 0, 0, .6)',
    shadowSoft: 'rgba(0, 0, 0, .5)'
  }
}
