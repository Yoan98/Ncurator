import { useState } from 'react'

function Versions(): React.JSX.Element {
  const [versions] = useState(window.electron.process.versions)

  return (
    <ul className="flex gap-4 text-xs text-[#9C9A94] justify-center mt-4">
      <li className="electron-version">Electron v{versions.electron}</li>
      <li className="chrome-version">Chromium v{versions.chrome}</li>
      <li className="node-version">Node v{versions.node}</li>
    </ul>
  )
}

export default Versions
