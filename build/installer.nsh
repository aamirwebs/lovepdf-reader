; LovePDF Reader — extra NSIS steps run by electron-builder (nsis.include).
; Registers the app the way Windows 10/11 "Default apps" and "Open with" expect:
;   * a ProgID for .pdf                      → Software\Classes\LovePDF.Reader.pdf
;   * Capabilities + RegisteredApplications   → the app appears in Settings ▸ Default apps as "LovePDF Reader"
;   * FriendlyAppName on the executable       → "Open with" shows "LovePDF Reader" instead of the file description
; SHCTX = HKCU for a per-user install, HKLM for an all-users install (electron-builder sets it).

!macro customInstall
  ; --- ProgID for PDF files
  WriteRegStr SHCTX "Software\Classes\LovePDF.Reader.pdf" "" "PDF Document"
  WriteRegStr SHCTX "Software\Classes\LovePDF.Reader.pdf" "FriendlyTypeName" "PDF Document"
  WriteRegStr SHCTX "Software\Classes\LovePDF.Reader.pdf" "AppUserModelID" "me.lovepdf.reader"
  WriteRegStr SHCTX "Software\Classes\LovePDF.Reader.pdf\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\LovePDF.Reader.pdf\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\LovePDF.Reader.pdf\shell\open" "" "Open with LovePDF Reader"
  WriteRegStr SHCTX "Software\Classes\LovePDF.Reader.pdf\shell\open" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\LovePDF.Reader.pdf\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Classes\LovePDF.Reader.pdf\shell\print" "" "Print with LovePDF Reader"
  WriteRegStr SHCTX "Software\Classes\LovePDF.Reader.pdf\shell\print\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --print "%1"'
  ; offer the ProgID in the "Open with" list for .pdf without stealing the current default
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "LovePDF.Reader.pdf" ""

  ; --- the executable itself: friendly name used by the "Open with" dialog and the taskbar
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "LovePDF Reader"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "ApplicationCompany" "LovePDF.me"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".pdf" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; --- Default-apps registration (Settings ▸ Apps ▸ Default apps ▸ "LovePDF Reader")
  WriteRegStr SHCTX "Software\LovePDF\Reader\Capabilities" "ApplicationName" "LovePDF Reader"
  WriteRegStr SHCTX "Software\LovePDF\Reader\Capabilities" "ApplicationDescription" "Free PDF reader and editor by LovePDF.me"
  WriteRegStr SHCTX "Software\LovePDF\Reader\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\LovePDF\Reader\Capabilities\FileAssociations" ".pdf" "LovePDF.Reader.pdf"
  WriteRegStr SHCTX "Software\LovePDF\Reader\Capabilities\MimeAssociations" "application/pdf" "LovePDF.Reader.pdf"
  WriteRegStr SHCTX "Software\RegisteredApplications" "LovePDF Reader" "Software\LovePDF\Reader\Capabilities"

  ; tell Explorer the associations changed (SHCNE_ASSOCCHANGED)
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\LovePDF.Reader.pdf"
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "LovePDF.Reader.pdf"
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegKey SHCTX "Software\LovePDF\Reader"
  DeleteRegKey /ifempty SHCTX "Software\LovePDF"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "LovePDF Reader"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
