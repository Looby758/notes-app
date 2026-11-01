import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import CaptureApp from './components/CaptureApp'
import YouTubeMini from './components/YouTube/YouTubeMini'
import MusicMini from './components/Music/MusicMini'
import VideoWindow from './components/Video/VideoWindow'
import SnipApp from './components/Snip/SnipApp'
import ShareCapture from './components/Share/ShareCapture'
import ShareDrop from './components/Share/ShareDrop'
import ScreenSend from './components/Screen/ScreenSend'
import ScreenView from './components/Screen/ScreenView'
import { loadPrefs } from './store/prefs'
import { startInterfaceSounds } from './lib/sounds'
import { IS_MAC } from '@shared/platform'
import './styles/theme.css'
import './styles/motion.css'

// Mac and Windows differ in a few places (window buttons, key symbols); CSS can check this.
document.documentElement.dataset.platform = IS_MAC ? 'mac' : 'win'

// The same page serves the main window, the quick-capture window (opened with #capture), the
// YouTube mini window (#youtube), the floating mini music player (#music) and screen snip (#snip).
const isCapture = location.hash === '#capture'
const isYouTube = location.hash === '#youtube'
const isMusic = location.hash === '#music'
const isSnip = location.hash === '#snip'
// The video player popped out into a window of its own.
const isVideo = location.hash === '#video'
// Mouse sharing's invisible window (holds the mouse while it's on the other computer) and its drop strip.
const isShareCapture = location.hash === '#share-capture'
const isShareDrop = location.hash === '#share-drop'
// Screens between the two computers: the hidden window that sends this screen, and the one showing the other's.
const isScreenSend = location.hash === '#screen-send'
const isScreenView = location.hash === '#screen-view'
if (isScreenSend || isScreenView) {
  document.body.classList.add('screen-window')
} else if (isShareCapture || isShareDrop) {
  document.body.classList.add(isShareCapture ? 'share-capture-window' : 'share-drop-window')
  loadPrefs().catch(() => undefined)
} else if (isCapture || isYouTube || isMusic || isSnip || isVideo) {
  document.body.classList.add(isCapture ? 'capture-window' : isYouTube ? 'youtube-window' : isSnip ? 'snip-window' : isVideo ? 'video-window-body' : 'music-window')
  loadPrefs().catch(() => undefined)
} else {
  startInterfaceSounds()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isScreenSend ? (
      <ScreenSend />
    ) : isScreenView ? (
      <ScreenView />
    ) : isShareCapture ? (
      <ShareCapture />
    ) : isShareDrop ? (
      <ShareDrop />
    ) : isCapture ? (
      <CaptureApp />
    ) : isYouTube ? (
      <YouTubeMini />
    ) : isMusic ? (
      <MusicMini />
    ) : isSnip ? (
      <SnipApp />
    ) : isVideo ? (
      <VideoWindow />
    ) : (
      <App />
    )}
  </StrictMode>
)
