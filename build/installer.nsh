; Windows installer extras (electron-builder includes this file; see nsis.include).
;
; An "Optional extras" page with one box, unticked: download ffmpeg, which the Studio needs to go
; live on Twitch or YouTube, and the file converter needs for videos. Ticking it leaves a note for Orbit, which downloads ffmpeg the first
; time it opens (Settings → Studio can do the same at any time). Silent updates skip the page.
;
; It also adds "Open in Orbit" to File Explorer's right-click menu for videos, comics and zips
; (removed again when Orbit is uninstalled). Uninstalling also removes Orbit's web browser
; registration, which Orbit adds itself when you make it the default browser (main/defaultBrowser.ts).

; "Open in Orbit" on one kind of file (HKCU\Software\Classes\SystemFileAssociations\.ext\shell).
!macro OrbitAddVerb EXT
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\OpenInOrbit" "MUIVerb" "Open in Orbit"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\OpenInOrbit" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\OpenInOrbit\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--open-in-orbit=%1"'
!macroend
!macro OrbitRemoveVerb EXT
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\OpenInOrbit"
!macroend

!macro customUnInstall
    ; Orbit as a web browser (only there if you chose "Make default" in Settings → Web browser).
    DeleteRegKey HKCU "Software\Classes\OrbitURL"
    DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Orbit"
    DeleteRegValue HKCU "Software\RegisteredApplications" "Orbit"
    !insertmacro OrbitRemoveVerb "mp4"
    !insertmacro OrbitRemoveVerb "m4v"
    !insertmacro OrbitRemoveVerb "mov"
    !insertmacro OrbitRemoveVerb "webm"
    !insertmacro OrbitRemoveVerb "mkv"
    !insertmacro OrbitRemoveVerb "avi"
    !insertmacro OrbitRemoveVerb "wmv"
    !insertmacro OrbitRemoveVerb "asf"
    !insertmacro OrbitRemoveVerb "flv"
    !insertmacro OrbitRemoveVerb "f4v"
    !insertmacro OrbitRemoveVerb "m2ts"
    !insertmacro OrbitRemoveVerb "mts"
    !insertmacro OrbitRemoveVerb "mpg"
    !insertmacro OrbitRemoveVerb "mpeg"
    !insertmacro OrbitRemoveVerb "vob"
    !insertmacro OrbitRemoveVerb "3gp"
    !insertmacro OrbitRemoveVerb "3g2"
    !insertmacro OrbitRemoveVerb "ogv"
    !insertmacro OrbitRemoveVerb "divx"
    !insertmacro OrbitRemoveVerb "rm"
    !insertmacro OrbitRemoveVerb "rmvb"
    !insertmacro OrbitRemoveVerb "cbz"
    !insertmacro OrbitRemoveVerb "cbr"
    !insertmacro OrbitRemoveVerb "zip"
    !insertmacro OrbitRemoveVerb "rar"
    !insertmacro OrbitRemoveVerb "7z"
!macroend

!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var FfmpegBox
  Var FfmpegWanted

  ; The page functions live inside this macro so they are defined after electron-builder has
  ; included Modern UI, which MUI_HEADER_TEXT needs.
  !macro customPageAfterChangeDir
    Page custom FfmpegPageCreate FfmpegPageLeave

    Function FfmpegPageCreate
      !insertmacro MUI_HEADER_TEXT "Optional extras" "Extra parts you can add now or later."
      nsDialogs::Create 1018
      Pop $0
      ${NSD_CreateCheckbox} 0 0 100% 12u "Download ffmpeg for live streaming and converting videos (about a 30 MB download)"
      Pop $FfmpegBox
      ${NSD_CreateLabel} 12u 18u 95% 40u "Only needed to go live on Twitch or YouTube and to convert videos (recording works without it). Orbit downloads it the first time it opens. You can also get it later in Settings → Studio."
      Pop $0
      ${If} $FfmpegWanted == "1"
        ${NSD_Check} $FfmpegBox
      ${EndIf}
      nsDialogs::Show
    FunctionEnd

    Function FfmpegPageLeave
      ${NSD_GetState} $FfmpegBox $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $FfmpegWanted "1"
      ${Else}
        StrCpy $FfmpegWanted "0"
      ${EndIf}
    FunctionEnd
  !macroend

  !macro customInstall
    ; "Open in Orbit" in File Explorer's right-click menu for videos, comics and zips (just for you,
    ; next to the usual Open; it doesn't change which app opens them on a double-click).
    !insertmacro OrbitAddVerb "mp4"
    !insertmacro OrbitAddVerb "m4v"
    !insertmacro OrbitAddVerb "mov"
    !insertmacro OrbitAddVerb "webm"
    !insertmacro OrbitAddVerb "mkv"
    !insertmacro OrbitAddVerb "avi"
    !insertmacro OrbitAddVerb "wmv"
    !insertmacro OrbitAddVerb "asf"
    !insertmacro OrbitAddVerb "flv"
    !insertmacro OrbitAddVerb "f4v"
    !insertmacro OrbitAddVerb "m2ts"
    !insertmacro OrbitAddVerb "mts"
    !insertmacro OrbitAddVerb "mpg"
    !insertmacro OrbitAddVerb "mpeg"
    !insertmacro OrbitAddVerb "vob"
    !insertmacro OrbitAddVerb "3gp"
    !insertmacro OrbitAddVerb "3g2"
    !insertmacro OrbitAddVerb "ogv"
    !insertmacro OrbitAddVerb "divx"
    !insertmacro OrbitAddVerb "rm"
    !insertmacro OrbitAddVerb "rmvb"
    !insertmacro OrbitAddVerb "cbz"
    !insertmacro OrbitAddVerb "cbr"
    !insertmacro OrbitAddVerb "zip"
    !insertmacro OrbitAddVerb "rar"
    !insertmacro OrbitAddVerb "7z"
    ; Tell File Explorer the menus changed.
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
    ${If} $FfmpegWanted == "1"
      CreateDirectory "$APPDATA\Orbit"
      FileOpen $0 "$APPDATA\Orbit\ffmpeg-wanted" w
      FileWrite $0 "1"
      FileClose $0
    ${EndIf}
  !macroend
!endif
