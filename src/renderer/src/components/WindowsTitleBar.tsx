import React from 'react'
import { HiMinus, HiStop, HiXMark } from 'react-icons/hi2'
import { windowSelectors } from '../testing/selectors'

const WindowsTitleBar: React.FC = () => {
  const handleMinimize = (): void => {
    window.electron?.ipcRenderer.send('window-minimize')
  }

  const handleMaximize = (): void => {
    window.electron?.ipcRenderer.send('window-maximize')
  }

  const handleClose = (): void => {
    window.electron?.ipcRenderer.send('window-close')
  }

  return (
    <div className="windows-titlebar">
      <button
        type="button"
        data-testid={windowSelectors.minimizeButton}
        className="windows-titlebar-button"
        onClick={handleMinimize}
        aria-label="最小化"
      >
        <HiMinus className="h-3 w-3" />
      </button>
      <button
        type="button"
        data-testid={windowSelectors.maximizeButton}
        className="windows-titlebar-button"
        onClick={handleMaximize}
        aria-label="最大化"
      >
        <HiStop className="h-3 w-3" />
      </button>
      <button
        type="button"
        data-testid={windowSelectors.closeButton}
        className="windows-titlebar-button windows-titlebar-close"
        onClick={handleClose}
        aria-label="关闭"
      >
        <HiXMark className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export default WindowsTitleBar
