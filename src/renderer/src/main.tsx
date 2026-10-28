import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import CaptureApp from './components/CaptureApp'
import YouTubeMini from './components/YouTube/YouTubeMini'
import { loadPrefs } from './store/prefs'
import { IS_MAC } from '@shared/platform'
import './styles/theme.css'

// Mac and Windows differ in a few places (window buttons, key symbols); CSS can check this.
document.documentElement.dataset.platform = IS_MAC ? 'mac' : 'win'

// The same page serves the main window, the quick-capture window (opened with #capture) and the
// YouTube mini window (#youtube).
const isCapture = location.hash === '#capture'
const isYouTube = location.hash === '#youtube'
if (isCapture || isYouTube) {
  document.body.classList.add(isCapture ? 'capture-window' : 'youtube-window')
  loadPrefs().catch(() => undefined)
}

createRoot(document.getElementById('root')!).render(<StrictMode>{isCapture ? <CaptureApp /> : isYouTube ? <YouTubeMini /> : <App />}</StrictMode>)
