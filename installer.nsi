Unicode true
Name "Total Telemetry"
OutFile "Total-Telemetry-1.2.31-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Total Telemetry"
InstallDirRegKey HKCU "Software\Total Telemetry" "InstallDir"
RequestExecutionLevel user
Icon "total-telemetry-icon.ico"
UninstallIcon "total-telemetry-icon.ico"
SetCompressor /SOLID lzma
VIProductVersion "1.2.31.0"
VIAddVersionKey "ProductName" "Total Telemetry"
VIAddVersionKey "FileDescription" "Total Telemetry Setup"
VIAddVersionKey "FileVersion" "1.2.31"
VIAddVersionKey "LegalCopyright" ""
Page components
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles
Section "!Total Telemetry"
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r /x "LMU Lap Workbench.exe" "win\*"
  SetOutPath "$INSTDIR"
  File "/oname=Total Telemetry.exe" "win\LMU Lap Workbench.exe"
  File "total-telemetry-icon.ico"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Total Telemetry.lnk" "$INSTDIR\Total Telemetry.exe" "" "$INSTDIR\total-telemetry-icon.ico"
  WriteRegStr HKCU "Software\Total Telemetry" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TotalTelemetry" "DisplayName" "Total Telemetry"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TotalTelemetry" "DisplayVersion" "1.2.31"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TotalTelemetry" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TotalTelemetry" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TotalTelemetry" "NoRepair" 1
SectionEnd
Section /o "Create a desktop shortcut"
  SetOutPath "$INSTDIR"
  CreateShortcut "$DESKTOP\Total Telemetry.lnk" "$INSTDIR\Total Telemetry.exe" "" "$INSTDIR\total-telemetry-icon.ico"
SectionEnd
Section "Uninstall"
  Delete "$DESKTOP\Total Telemetry.lnk"
  Delete "$SMPROGRAMS\Total Telemetry.lnk"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\Total Telemetry.exe"
  Delete "$INSTDIR\total-telemetry-icon.ico"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\version"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Total Telemetry"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TotalTelemetry"
SectionEnd
