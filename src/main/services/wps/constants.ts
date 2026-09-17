export const WPS_ADDON_NAME = 'ncurator-sync'
export const WPS_ADDON_VERSION = '1.0.0'
export const WPS_ADDON_DIR_NAME = `${WPS_ADDON_NAME}_${WPS_ADDON_VERSION}`
export const WPS_ADDON_LEGACY_NAMES = ['ncuratorsyncpoc']
export const WPS_ADDON_HOSTS = ['wps', 'et', 'wpp'] as const
export const WPS_ADDON_FILES = ['manifest.xml', 'ribbon.xml', 'index.html', 'main.js'] as const
export const WPS_ADDON_PORT_FILE = `${WPS_ADDON_NAME}.port.json`
// 不用 49152 以上的 ephemeral 端口：Windows Hyper-V/WinNAT 会动态排除这段，
// 58123 落在排除区时 listen 直接 EACCES，回环起不来，加载项也就连不上。
export const WPS_PREFERRED_SYNC_PORT = 18723
