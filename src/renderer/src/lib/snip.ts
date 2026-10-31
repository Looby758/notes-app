import { notify } from '../store/notify'
import { askEverything } from '../store/ai'
import { saveCapture } from './capture'

/** Screen snip, from inside the app (the system-wide shortcut goes straight to main/snip.ts). */
export function startSnip(): Promise<void> {
  return window.api.startSnip()
}

/** Main window: what to do with text that came back from a snip. */
export function watchSnips(): () => void {
  const offText = window.api.onSnipText((action, text) => {
    if (action === 'ask') {
      void askEverything(`Here's some text from my screen:\n\n${text}\n\nWhat is this, and what should I know about it?`)
      return
    }
    saveCapture(text.includes('\n') ? `Snipped:\n${text}` : text).then(
      (r) => notify(r.ok ? `Saved in ${r.where}.` : (r.error ?? 'Couldn’t save it.'), r.ok ? 'info' : 'error'),
      (err) => notify(err)
    )
  })
  const offFailed = window.api.onSnipFailed((message) => notify(message))
  return () => {
    offText()
    offFailed()
  }
}
