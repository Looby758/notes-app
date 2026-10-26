import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import CaptureApp from './components/CaptureApp'
import { loadPrefs } from './store/prefs'
import { IS_MAC } from '@shared/platform'
import './styles/theme.css'

// Mac and Windows differ in a few places (window buttons, key symbols); CSS can check this.
document.documentElement.dataset.platform = IS_MAC ? 'mac' : 'win'

// The same page serves the main window and the quick-capture window (opened with #capture).
const isCapture = location.hash === '#capture'
if (isCapture) {
  document.body.classList.add('capture-window')
  loadPrefs().catch(() => undefined)
}

createRoot(document.getElementById('root')!).render(<StrictMode>{isCapture ? <CaptureApp /> : <App />}</StrictMode>)
