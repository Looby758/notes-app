; Windows installer extras (electron-builder includes this file; see nsis.include).
;
; An "Optional extras" page with one box, unticked: download ffmpeg, which the Studio needs to go
; live on Twitch or YouTube, and the file converter needs for videos. Ticking it leaves a note for Orbit, which downloads ffmpeg the first
; time it opens (Settings → Studio can do the same at any time). Silent updates skip the page.
!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var FfmpegBox
  Var FfmpegWanted

  !macro customPageAfterChangeDir
    Page custom FfmpegPageCreate FfmpegPageLeave
  !macroend

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

  !macro customInstall
    ${If} $FfmpegWanted == "1"
      CreateDirectory "$APPDATA\Orbit"
      FileOpen $0 "$APPDATA\Orbit\ffmpeg-wanted" w
      FileWrite $0 "1"
      FileClose $0
    ${EndIf}
  !macroend
!endif
