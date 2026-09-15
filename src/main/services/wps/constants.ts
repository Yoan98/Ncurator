export const WPS_ADDON_NAME = 'ncurator-sync'
export const WPS_ADDON_VERSION = '1.0.0'
export const WPS_ADDON_DIR_NAME = `${WPS_ADDON_NAME}_${WPS_ADDON_VERSION}`
export const WPS_ADDON_LEGACY_NAMES = ['ncuratorsyncpoc']
export const WPS_ADDON_HOSTS = ['wps', 'et', 'wpp'] as const
export const WPS_ADDON_FILES = ['manifest.xml', 'ribbon.xml', 'index.html', 'main.js'] as const
export const WPS_ADDON_PORT_FILE = `${WPS_ADDON_NAME}.port.json`
export const WPS_PREFERRED_SYNC_PORT = 58123
