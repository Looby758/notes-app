import { useEffect, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import { ExternalLink, LogOut, MessagesSquare, MoreHorizontal, RotateCw } from 'lucide-react'
import { badgeText, MESSAGES_PARTITION, MESSAGES_SITES, unreadFromTitle, type MessagesService, type MessagesSite } from '@shared/messages'
import { openSpecialTab, MESSAGES_TAB } from '../../lib/editorController'
import { setUnread, showMessages, useMessages, useTotalUnread } from '../../store/messages'
import { notify } from '../../store/notify'
import Private from '../Streamer/Private'

/** The site pages on screen, so the bar's buttons can reach them. */
const views = new Map<MessagesService, WebviewTag>()

/** Signs you out of WhatsApp and Discord, after asking. */
async function signOut(): Promise<void> {
  const ok = await window.api.confirm({
    type: 'warning',
    message: 'Sign out of WhatsApp and Discord?',
    detail: 'You’ll need to link WhatsApp again with your phone and sign in to Discord again. Your messages stay on your phone and on Discord.',
    ok: 'Sign out'
  })
  if (!ok) return
  try {
    await window.api.clearMessagesData()
    for (const view of views.values()) view.reload()
    notify('Signed out of WhatsApp and Discord.', 'info')
  } catch (err) {
    notify(err)
  }
}

/** The title bar button, with how many messages are waiting. */
export function MessagesButton() {
  const { count, dot } = useTotalUnread()
  return (
    <button
      className="icon-btn messages-button"
      onClick={() => openSpecialTab(MESSAGES_TAB)}
      title={`Messages (WhatsApp, Discord)${count ? `: ${count} unread` : dot ? ': new messages' : ''}`}
      data-messages-button
    >
      <MessagesSquare size={15} />
      {count > 0 ? <span className="messages-badge">{badgeText(count)}</span> : dot && <span className="messages-badge dot" />}
    </button>
  )
}

/** The unread count on a tab or button: a number, a dot for "something new", or nothing. */
export function UnreadBadge({ service }: { service?: MessagesService }) {
  const total = useTotalUnread()
  const one = useMessages((s) => (service ? s.unread[service] : undefined))
  const { count, dot } = service ? (one ?? { count: 0, dot: false }) : total
  if (count > 0) return <span className="unread-badge">{badgeText(count)}</span>
  return dot ? <span className="unread-badge dot" /> : null
}

/**
 * The messages hub: WhatsApp and Discord side by side as tabs, each the real website in a walled-off
 * page (main/browser.ts) with sign-ins kept in its own storage. Both stay loaded while the hub is
 * open, so their unread counts keep updating while you're in your notes.
 */
export default function MessagesPage({ hidden, autoFocus }: { hidden: boolean; autoFocus: boolean }) {
  const showing = useMessages((s) => s.showing)
  const used = useMessages((s) => s.used)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const site = MESSAGES_SITES.find((s) => s.id === showing) ?? MESSAGES_SITES[0]

  return (
    <div className={`messages-page ${hidden ? 'hidden' : ''}`}>
      <div className="messages-bar">
        {MESSAGES_SITES.map((s) => (
          <button key={s.id} className={`messages-tab ${s.id === showing ? 'active' : ''}`} onClick={() => showMessages(s.id)} data-messages-tab={s.id}>
            <span className={`messages-logo ${s.id}`} />
            {s.name}
            <UnreadBadge service={s.id} />
          </button>
        ))}
        <div className="messages-spacer" />
        <button className="icon-btn" title={`Reload ${site.name}`} onClick={() => views.get(showing)?.reload()}>
          <RotateCw size={14} />
        </button>
        <button className="icon-btn" title={`Open ${site.name} in your browser`} onClick={() => window.open(site.url)}>
          <ExternalLink size={14} />
        </button>
        <div className="web-menu-wrap" onMouseDown={(e) => e.stopPropagation()}>
          <button className={`icon-btn ${menu ? 'active' : ''}`} title="More" onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={15} />
          </button>
          {menu && (
            <div className="menu web-menu">
              <button
                onClick={() => {
                  setMenu(false)
                  void signOut()
                }}
              >
                <LogOut size={15} /> Sign out of WhatsApp and Discord
              </button>
            </div>
          )}
        </div>
      </div>
      {/* Web pages can't be blurred, so streamer mode covers them completely. */}
      <Private cover opaque label="Your messages are hidden for streamer mode">
        <div className="web-body">
          {MESSAGES_SITES.filter((s) => used.includes(s.id)).map((s) => (
            <SiteView key={s.id} site={s} shown={s.id === showing} focus={!hidden && autoFocus && s.id === showing} />
          ))}
        </div>
      </Private>
    </div>
  )
}

/** One site, loaded once and kept loaded; its page title says how many messages are waiting. */
function SiteView({ site, shown, focus }: { site: MessagesSite; shown: boolean; focus: boolean }) {
  const viewEl = useRef<HTMLWebViewElement>(null)
  const view = viewEl as unknown as { current: WebviewTag | null }
  const [failure, setFailure] = useState('')

  useEffect(() => {
    const el = view.current
    if (!el) return
    views.set(site.id, el)
    const onTitle = (e: Event): void => setUnread(site.id, unreadFromTitle((e as Event & { title: string }).title))
    const onNavigate = (e: Event): void => {
      if ((e as Event & { isMainFrame?: boolean }).isMainFrame !== false) setFailure('')
    }
    const onFail = (e: Event): void => {
      const { errorCode, errorDescription, isMainFrame } = e as Event & { errorCode: number; errorDescription: string; isMainFrame: boolean }
      // -3 is a page load that was cancelled: not a failure.
      if (isMainFrame && errorCode !== -3) setFailure(errorDescription || 'The page didn’t load.')
    }
    el.addEventListener('page-title-updated', onTitle)
    el.addEventListener('did-navigate', onNavigate)
    el.addEventListener('did-fail-load', onFail)
    return () => {
      if (views.get(site.id) === el) views.delete(site.id)
      el.removeEventListener('page-title-updated', onTitle)
      el.removeEventListener('did-navigate', onNavigate)
      el.removeEventListener('did-fail-load', onFail)
      setUnread(site.id, null)
    }
  }, [site.id])

  useEffect(() => {
    if (focus) view.current?.focus()
  }, [focus])

  return (
    <div className={`messages-site ${shown ? '' : 'hidden'}`}>
      {/* allowpopups lets sign-in pop-ups and links reach main/browser.ts (links open in a web tab). */}
      <webview ref={viewEl} src={site.url} partition={MESSAGES_PARTITION} allowpopups={'true' as unknown as boolean} className="web-view" />
      {failure && (
        <div className="web-failed">
          <p>Couldn’t open {site.name}</p>
          <span>{failure}</span>
          <div>
            <button className="btn" onClick={() => view.current?.reload()}>
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
