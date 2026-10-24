; Installer hooks (bundle > windows > nsis > installerHooks).
;
; Sonolith used to be called ytdesk, installed per user under the product name "ytdesk". The new installer has a
; different product name, so without this it would install next to the old app and leave its Start menu entry and
; its "Apps & features" entry behind. Before copying files, run the old uninstaller silently: /S keeps the app data
; (the "delete app data" box is only ticked by hand), which Sonolith copies from dev.ytdesk.app on its first launch.

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ytdesk" "InstallLocation"
  ${If} $R0 != ""
    ; Written quoted ("C:\...\ytdesk").
    StrCpy $R1 $R0 1
    ${If} $R1 == '"'
      StrCpy $R0 $R0 -1 1
    ${EndIf}
    ${If} ${FileExists} "$R0\uninstall.exe"
      DetailPrint "Removing ytdesk (Sonolith's old name) from $R0"
      ; _?= runs the uninstaller in place and waits for it; it then can't delete itself, so do that here.
      ExecWait '"$R0\uninstall.exe" /S _?=$R0'
      Delete "$R0\uninstall.exe"
      RMDir "$R0"
    ${EndIf}
    ; Whatever the uninstaller left (or a broken old install): no orphaned entries.
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ytdesk"
    DeleteRegKey HKCU "Software\opecko\ytdesk"
  ${EndIf}
!macroend
