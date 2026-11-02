import { contextBridge, ipcRenderer } from 'electron'
import { quietPasskeys } from '@shared/passkeys'
import { firefoxOnGoogleSignIn, firefoxUserAgent, isGoogleSignIn } from '@shared/web'

/**
 * Runs in every web page (web tabs, the messages hub, the YouTube mini window) before the site's
 * own code. It gives the page nothing; it only stops passkey prompts popping up as pages load
 * (see quietPasskeys), and passes the mouse's back and forward buttons on to the app.
 */
contextBridge.executeInMainWorld({ func: quietPasskeys })
// Google's sign-in pages see the same Firefox the request said (see firefoxOnGoogleSignIn), unless
// "Sign in with Google as Firefox" is off. Only Google's sign-in pages ask.
if (isGoogleSignIn(location.href) && ipcRenderer.sendSync('web:googleAsFirefox') !== false) {
  contextBridge.executeInMainWorld({ func: firefoxOnGoogleSignIn, args: [firefoxUserAgent(process.platform)] })
}

// The mouse's side buttons (3 = back, 4 = forward): the app steps the page back or forward, or
// moves around the app once the page can't (main/browser.ts passes them on).
window.addEventListener(
  'mouseup',
  (e) => {
    if (e.button !== 3 && e.button !== 4) return
    e.preventDefault()
    ipcRenderer.send('web:mouseNav', e.button === 3 ? -1 : 1)
  },
  true
)
