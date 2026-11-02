import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bookmark as BookmarkIcon, Check, ChevronRight, Eraser, Folder, FolderPlus, Globe, Pencil, Search, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import {
  childrenOf,
  folderChoices,
  hostOf,
  isRoot,
  PERMISSION_NAMES,
  ROOT_NAMES,
  searchBookmarks,
  SITE_PERMISSIONS,
  type Bookmark,
  type HistoryHit,
  type SitePermission,
  type SiteSettings
} from '@shared/browser'
import { addFolder, placeBookmark, removeBookmark, setSite, updateBookmark, useBrowser } from '../../store/browser'
import { notify } from '../../store/notify'

// ---------- bookmarks ----------

/** The bookmark manager: folders to go into, and each bookmark to open, rename, move or remove. */
export function BookmarksPanel({ onOpen }: { onOpen: (url: string, newTab: boolean) => void }) {
  const all = useBrowser((s) => s.bookmarks)
  const [folder, setFolder] = useState<string>('bar')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  // A folder that's been deleted (here or on the bar) takes you back to the top.
  const here = isRoot(folder) || all.some((b) => b.id === folder) ? folder : 'bar'
  const items = query.trim() ? searchBookmarks(all, query) : childrenOf(all, here)
  const crumbs = useMemo(() => {
    const out: { id: string; title: string }[] = []
    let at = here
    while (!isRoot(at)) {
      const f = all.find((b) => b.id === at)
      if (!f) break
      out.unshift({ id: f.id, title: f.title || 'Folder' })
      at = f.parent
    }
    if (isRoot(at)) out.unshift({ id: at, title: ROOT_NAMES[at] })
    return out
  }, [all, here])

  return (
    <div className="web-panel-body" data-bookmarks-panel>
      <div className="web-panel-search">
        <Search size={13} />
        <input className="text-input" placeholder="Search bookmarks" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!query.trim() && (
        <div className="web-panel-crumbs">
          <div className="web-panel-roots">
            {(['bar', 'other'] as const).map((r) => (
              <button key={r} className={crumbs[0]?.id === r ? 'on' : ''} onClick={() => setFolder(r)}>
                {ROOT_NAMES[r]}
              </button>
            ))}
          </div>
          {crumbs.length > 1 && (
            <div className="web-panel-path">
              <button className="icon-btn" title="Up a folder" onClick={() => setFolder(crumbs[crumbs.length - 2].id)}>
                <ArrowLeft size={13} />
              </button>
              {crumbs.slice(1).map((c) => (
                <span key={c.id}>
                  <ChevronRight size={12} /> {c.title}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="web-panel-list">
        {items.length === 0 && <p className="web-panel-empty">{query.trim() ? 'No bookmarks match.' : 'Nothing in here yet. Press ☆ in the address bar (or Ctrl+D) to bookmark a page.'}</p>}
        {items.map((b) =>
          editing === b.id ? (
            <EditBookmark key={b.id} bookmark={b} done={() => setEditing(null)} />
          ) : (
            <div key={b.id} className="web-panel-row" data-bookmark={b.id}>
              <button
                className="web-panel-main"
                title={b.url ?? b.title}
                onClick={(e) => (b.kind === 'folder' ? setFolder(b.id) : onOpen(b.url!, e.ctrlKey || e.metaKey))}
                onAuxClick={(e) => e.button === 1 && b.url && onOpen(b.url, true)}
              >
                {b.kind === 'folder' ? <Folder size={14} /> : <BookmarkIcon size={14} />}
                <span className="web-panel-title">{b.title || (b.url ? hostOf(b.url) : 'Folder')}</span>
                {b.url && <span className="web-panel-sub">{hostOf(b.url)}</span>}
              </button>
              <button className="icon-btn" title="Edit" onClick={() => setEditing(b.id)}>
                <Pencil size={12} />
              </button>
              <button className="icon-btn" title={b.kind === 'folder' ? 'Delete the folder and everything in it' : 'Delete'} onClick={() => removeBookmark(b.id)}>
                <Trash2 size={12} />
              </button>
            </div>
          )
        )}
      </div>
      {!query.trim() && (
        <button
          className="btn web-panel-foot"
          onClick={() => {
            const f = addFolder('New folder', here)
            setEditing(f.id)
          }}
        >
          <FolderPlus size={13} /> New folder
        </button>
      )}
    </div>
  )
}

/** Renaming a bookmark (and its address), or moving it to another folder. */
export function EditBookmark({ bookmark, done, autoFocus = true }: { bookmark: Bookmark; done: () => void; autoFocus?: boolean }) {
  const all = useBrowser((s) => s.bookmarks)
  const [title, setTitle] = useState(bookmark.title)
  const [url, setUrl] = useState(bookmark.url ?? '')
  const folders = folderChoices(all).filter((f) => bookmark.kind !== 'folder' || (f.id !== bookmark.id && !f.label.includes(` / ${bookmark.title} /`)))
  const save = (): void => {
    const patch: Partial<Bookmark> = { title: title.trim() || bookmark.title }
    if (bookmark.kind === 'link') {
      if (!hostOf(url.trim())) return notify('That isn’t a web address.')
      patch.url = url.trim()
    }
    updateBookmark(bookmark.id, patch)
    done()
  }
  return (
    <form
      className="web-bookmark-edit"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), done())}
    >
      <label>
        <span>Name</span>
        <input className="text-input" autoFocus={autoFocus} value={title} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.target.select()} />
      </label>
      {bookmark.kind === 'link' && (
        <label>
          <span>Address</span>
          <input className="text-input" value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
        </label>
      )}
      <label>
        <span>Folder</span>
        <select className="text-input" value={bookmark.parent} onChange={(e) => placeBookmark(bookmark.id, e.target.value)}>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <div className="web-bookmark-edit-foot">
        <button type="button" className="btn" onClick={() => (removeBookmark(bookmark.id), done())}>
          <Trash2 size={13} /> Remove
        </button>
        <button type="submit" className="btn btn-primary">
          <Check size={13} /> Done
        </button>
      </div>
    </form>
  )
}

// ---------- history ----------

const dayLabel = (t: number): string => {
  const d = new Date(t)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

/** Your browsing history, searchable by the page's title, its address, or the words that were on it. */
export function HistoryPanel({ onOpen }: { onOpen: (url: string, newTab: boolean) => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<HistoryHit[] | null>(null)
  const [again, setAgain] = useState(0)
  useEffect(() => {
    let live = true
    const t = setTimeout(() => void window.api.webHistory(query, 300).then((h) => live && setHits(h)), query ? 150 : 0)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query, again])

  const clear = async (): Promise<void> => {
    const ok = await window.api.confirm({ type: 'warning', message: 'Clear your browsing history?', detail: 'Every page you’ve visited is forgotten. You stay signed in to websites.', ok: 'Clear history' })
    if (!ok) return
    await window.api.webHistoryClear()
    setAgain((n) => n + 1)
  }

  let lastDay = ''
  return (
    <div className="web-panel-body" data-history-panel>
      <div className="web-panel-search">
        <Search size={13} />
        <input className="text-input" autoFocus placeholder="Search by title, address or words on the page" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="web-panel-list">
        {hits && hits.length === 0 && <p className="web-panel-empty">{query ? 'Nothing in your history matches.' : 'Pages you visit show here. Private tabs aren’t remembered.'}</p>}
        {hits?.map((h) => {
          const day = dayLabel(h.visited)
          const heading = day !== lastDay ? day : null
          lastDay = day
          return (
            <div key={h.url}>
              {heading && <div className="web-panel-day">{heading}</div>}
              <div className="web-panel-row" data-history={h.url}>
                <button className="web-panel-main" title={h.url} onClick={(e) => onOpen(h.url, e.ctrlKey || e.metaKey)} onAuxClick={(e) => e.button === 1 && onOpen(h.url, true)}>
                  <Globe size={14} />
                  <span className="web-panel-title">{h.title || hostOf(h.url)}</span>
                  <span className="web-panel-sub">
                    {new Date(h.visited).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {hostOf(h.url)}
                  </span>
                  {h.snippet && <span className="web-panel-snippet">{h.snippet}</span>}
                </button>
                <button
                  className="icon-btn"
                  title="Remove from history"
                  onClick={() => {
                    void window.api.webHistoryRemove(h.url)
                    setHits((list) => list?.filter((x) => x.url !== h.url) ?? null)
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <button className="btn web-panel-foot" onClick={() => void clear()}>
        <Eraser size={13} /> Clear history
      </button>
    </div>
  )
}

// ---------- site settings ----------

const DECISIONS = [
  { value: '', label: 'Ask' },
  { value: 'allow', label: 'Allow' },
  { value: 'block', label: 'Block' }
]

/** Signs you out of one site and forgets what it stored, after asking. */
export async function clearSiteData(site: string): Promise<void> {
  const ok = await window.api.confirm({
    type: 'warning',
    message: `Clear ${site}’s data?`,
    detail: `You’ll be signed out of ${site}, and what it stored (cookies, saved data) is forgotten. Other sites aren’t touched, and logins saved in Passwords are kept.`,
    ok: 'Clear'
  })
  if (!ok) return
  try {
    await window.api.webClearSite(site)
    notify(`Cleared ${site}. You’re signed out of it.`, 'info')
  } catch (err) {
    notify(err)
  }
}

function SiteRow({ site, settings, open, toggle }: { site: string; settings: SiteSettings; open: boolean; toggle: () => void }) {
  const perms = settings.permissions ?? {}
  const summary = [
    ...SITE_PERMISSIONS.filter((p) => perms[p]).map((p) => `${PERMISSION_NAMES[p]}: ${perms[p] === 'allow' ? 'allowed' : 'blocked'}`),
    settings.zoom ? `Zoom ${Math.round(settings.zoom * 100)}%` : '',
    settings.muted ? 'Muted' : settings.volume !== undefined ? `Volume ${settings.volume}%` : ''
  ].filter(Boolean)
  return (
    <div className={`web-site ${open ? 'open' : ''}`} data-site={site}>
      <button className="web-panel-main" onClick={toggle}>
        <Globe size={14} />
        <span className="web-panel-title">{site}</span>
        <span className="web-panel-sub">{summary.join(' · ') || 'Nothing set'}</span>
      </button>
      {open && (
        <div className="web-site-settings">
          {SITE_PERMISSIONS.map((p: SitePermission) => (
            <label key={p} className="web-site-perm">
              <span>{PERMISSION_NAMES[p]}</span>
              <select className="text-input" value={perms[p] ?? ''} onChange={(e) => setSite(site, { permissions: { [p]: (e.target.value || undefined) as 'allow' | 'block' | undefined } })}>
                {DECISIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div className="web-site-perm">
            <span>Zoom</span>
            <span className="web-site-value">
              {Math.round((settings.zoom ?? 1) * 100)}%
              {settings.zoom && (
                <button className="btn web-small-btn" onClick={() => setSite(site, { zoom: 1 })}>
                  Reset
                </button>
              )}
            </span>
          </div>
          <div className="web-site-perm">
            <span>Sound</span>
            <span className="web-site-value web-site-sound">
              <button className="icon-btn" title={settings.muted ? 'Unmute' : 'Mute this site'} onClick={() => setSite(site, { muted: !settings.muted || undefined })}>
                {settings.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <input type="range" min={0} max={100} value={settings.volume ?? 100} onChange={(e) => setSite(site, { volume: Number(e.target.value) >= 100 ? undefined : Number(e.target.value) })} />
              <span>{settings.volume ?? 100}%</span>
            </span>
          </div>
          {settings.neverSavePasswords && (
            <div className="web-site-perm">
              <span>Passwords</span>
              <span className="web-site-value">
                Never offered
                <button className="btn web-small-btn" onClick={() => setSite(site, { neverSavePasswords: undefined })}>
                  Offer again
                </button>
              </span>
            </div>
          )}
          <div className="web-site-foot">
            <button className="btn" onClick={() => void clearSiteData(site)} title="Sign out of this site and forget its cookies and saved data">
              <Eraser size={13} /> Clear site data
            </button>
            <button className="btn" onClick={() => void window.api.webSiteForget(site).then((sites) => useBrowser.setState({ sites }))} title="Put this site’s settings back to normal">
              Reset settings
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * One place for every site's settings: what it may use (notifications, the mic, the camera…), its
 * zoom and sound, and a button to clear just that site's data. `current` (the tab's site) is first.
 */
export function SitesPanel({ current }: { current?: string }) {
  const sites = useBrowser((s) => s.sites)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(current ?? null)
  const names = useMemo(() => {
    const list = Object.keys(sites).sort()
    const all = current && !list.includes(current) ? [current, ...list] : current ? [current, ...list.filter((s) => s !== current)] : list
    const q = query.trim().toLowerCase()
    return q ? all.filter((s) => s.includes(q)) : all
  }, [sites, current, query])
  return (
    <div className="web-panel-body" data-sites-panel>
      <div className="web-panel-search">
        <Search size={13} />
        <input className="text-input" placeholder="Find a site" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="web-panel-list">
        {names.length === 0 && <p className="web-panel-empty">Sites you’ve allowed or blocked something for, zoomed or turned down show here.</p>}
        {names.map((site) => (
          <SiteRow key={site} site={site} settings={sites[site] ?? {}} open={open === site} toggle={() => setOpen(open === site ? null : site)} />
        ))}
      </div>
    </div>
  )
}
