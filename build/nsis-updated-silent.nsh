!macro customHeader
  !include "WordFunc.nsh"
!macroend

!macro preventDowngrade ROOT_KEY
  ReadRegStr $R0 ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${if} $R0 != ""
    ${VersionCompare} "$R0" "${VERSION}" $R1
    ${if} $R1 == "1"
      ${ifNot} ${Silent}
        MessageBox mb_IconStop|mb_TopMost|mb_SetForeground "已安装更新版本的馆长（$R0）。不能安装旧版本 ${VERSION}，请继续使用已安装版本或下载最新版。"
      ${endIf}
      Quit
    ${endIf}
  ${endIf}
!macroend

!macro customInit
  !insertmacro preventDowngrade HKCU
  !insertmacro preventDowngrade HKLM
  ${if} ${isUpdated}
    SetSilent silent
  ${endIf}
!macroend
