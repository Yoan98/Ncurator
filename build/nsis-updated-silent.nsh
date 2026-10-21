!macro customHeader
  !include "WordFunc.nsh"
!macroend

!macro preventDowngrade ROOT_KEY
  ReadRegStr $R0 ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${if} $R0 != ""
    ${VersionCompare} "$R0" "${VERSION}" $R1
    ${if} $R1 == "1"
      ${ifNot} ${Silent}
        MessageBox mb_IconStop|mb_TopMost|mb_SetForeground "A newer version of ${PRODUCT_NAME} ($R0) is installed. Cannot install older version ${VERSION}. Please use the installed version or download the latest release."
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
