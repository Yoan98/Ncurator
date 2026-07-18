import React from 'react'
import { windowSelectors } from '../../testing/selectors'

const isWindowsRenderer = (): boolean =>
  navigator.userAgent.toLowerCase().includes('windows') ||
  navigator.platform.toLowerCase().includes('win')

const AppWindowFrame: React.FC<React.PropsWithChildren> = ({ children }) => {
  const isWindows = isWindowsRenderer()

  return (
    <div className={`nc-window-frame ${isWindows ? 'nc-window-frame-windows' : ''}`}>
      {isWindows ? (
        <header
          className="nc-native-window-chrome"
          data-testid={windowSelectors.nativeChrome}
          aria-hidden="true"
        >
          <div
            className="nc-native-window-chrome-drag-region"
            data-testid={windowSelectors.nativeChromeDragRegion}
          />
        </header>
      ) : null}
      <div className="nc-window-content" data-testid={windowSelectors.content}>
        {children}
      </div>
    </div>
  )
}

export default AppWindowFrame
