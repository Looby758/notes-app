import type { WebContents } from 'electron'
import { isGoogleSignIn, traceUrl } from '@shared/web'
import { logError } from './log'

/**
 * A note in the log file (Settings → About → Show log file) of each step of a Google sign-in, so a
 * sign-in that goes wrong on someone's computer can be looked into: every page it passes through
 * (site and page only, never the codes in the address), the pop-ups it opens and closes, and
 * whether a pop-up can still hand the sign-in back to the page that opened it.
 *
 * It starts when a page heads to Google's sign-in, and stops five minutes after the last step.
 */

const QUIET_AFTER = 5 * 60_000

let until = 0

const on = (): boolean => Date.now() < until

/** A step. `url` starts (or keeps going) the note if it's one of Google's sign-in pages. */
export function traceSignIn(page: WebContents, step: string, url = '', extra = ''): void {
  if (url && isGoogleSignIn(url)) until = Date.now() + QUIET_AFTER
  if (!on()) return
  let who = `page ${page.id}`
  try {
    who = `${page.getType() === 'webview' ? 'page' : 'pop-up'} ${page.id}`
    const opener = page.getType() === 'window' ? (page.opener ? ' opener:yes' : ' opener:no') : ''
    const agent = /Firefox\//.test(page.getUserAgent()) ? ' as:firefox' : ' as:chromium'
    extra = `${extra}${opener}${agent}`
  } catch {
    // The page has gone.
  }
  logError('sign-in', `${who} ${step}${url ? ` ${traceUrl(url)}` : ''}${extra}`)
}

/** Follows one page (a web tab, Grok, or a sign-in pop-up) through a sign-in. */
export function watchSignIn(page: WebContents): void {
  page.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) traceSignIn(page, 'goes to', details.url)
  })
  page.on('will-redirect', (_e, url, _inPlace, isMainFrame) => {
    if (isMainFrame) traceSignIn(page, 'is sent on to', url)
  })
  page.on('did-navigate', (_e, url, code) => traceSignIn(page, 'shows', url, ` (${code})`))
  page.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) traceSignIn(page, 'failed to load', url, ` (${code} ${description})`)
  })
  page.on('console-message', (details) => {
    const { level, message } = details as unknown as { level: string; message: string }
    if (on() && level === 'error') traceSignIn(page, 'page error:', '', ` ${String(message).slice(0, 160)}`)
  })
  const name = `${page.getType() === 'window' ? 'pop-up' : 'page'} ${page.id}`
  page.once('destroyed', () => {
    if (on()) logError('sign-in', `${name} closed`)
  })
}
