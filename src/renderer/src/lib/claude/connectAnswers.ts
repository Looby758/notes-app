import type { Bookmark } from '@shared/browser'
import { sendToPhone } from '../../store/phone'
import { openWebTab } from '../editorController'
import { findNote, htmlText, locked, needNotes, num, pickOne, str, type Answer, type Args } from './common'

/** Discord voice, the phone, Orbit's web browser and offline wikis, for Claude Desktop. */

// ---------- Discord ----------

const minutes = (ms: number): string => {
  const m = Math.round(ms / 60_000)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}

async function discord(): Promise<Awaited<ReturnType<typeof window.api.discordGet>>> {
  const s = await window.api.discordGet()
  if (s.stage !== 'ready') throw new Error(s.error || 'Discord isn’t connected in Orbit (set it up on the Discord page).')
  return s
}

async function discordStatusFor(): Promise<string> {
  const s = await discord()
  const you = `They’re ${s.mute ? 'muted' : 'not muted'} and ${s.deaf ? 'deafened' : 'not deafened'}.`
  if (!s.channel) return `Not in a voice channel. ${you}`
  const c = s.channel
  const people = c.members
    .filter((m) => m.id !== s.me?.id)
    .map((m) => `${m.name}${m.speaking ? ' (talking)' : ''}${m.selfMute || m.serverMute ? ' (muted)' : ''}${m.selfDeaf || m.serverDeaf ? ' (deafened)' : ''}${m.volume !== 100 ? ` (volume ${m.volume}%)` : ''}`)
  const chat = s.chat.slice(-15).map((m) => `${m.author}: ${m.content}`)
  return [`In ${c.name}${c.server ? ` on ${c.server}` : ''} for ${minutes(Date.now() - c.joinedAt)}. ${you}`, `With: ${people.join(', ') || 'nobody else'}`, chat.length ? `Recent chat:\n${chat.join('\n')}` : ''].filter(Boolean).join('\n')
}

async function discordSetFor(args: Args): Promise<string> {
  await discord()
  const said: string[] = []
  if (typeof args.mute === 'boolean') {
    await window.api.discordSet('mute', args.mute)
    said.push(args.mute ? 'Muted.' : 'Unmuted.')
  }
  if (typeof args.deaf === 'boolean') {
    await window.api.discordSet('deaf', args.deaf)
    said.push(args.deaf ? 'Deafened.' : 'Undeafened.')
  }
  if (!said.length) throw new Error('Say mute and/or deaf (true or false).')
  return said.join(' ')
}

async function discordLeaveFor(): Promise<string> {
  const s = await discord()
  if (!s.channel) return 'They’re not in a voice channel.'
  await window.api.discordLeave()
  return `Left ${s.channel.name}.`
}

async function discordUserFor(args: Args): Promise<string> {
  const s = await discord()
  if (!s.channel) throw new Error('They’re not in a voice channel.')
  const m = pickOne(
    s.channel.members.filter((x) => x.id !== s.me?.id),
    str(args.user),
    (x) => x.name,
    'person in the call'
  )
  const patch: { volume?: number; mute?: boolean } = {}
  if (typeof args.volume === 'number') patch.volume = Math.min(200, Math.max(0, Math.round(args.volume)))
  if (typeof args.mute === 'boolean') patch.mute = args.mute
  if (!Object.keys(patch).length) throw new Error('Say a volume (0 to 200) or mute.')
  await window.api.discordUserVoice(m.id, patch)
  return `${m.name}: ${patch.volume !== undefined ? `volume ${patch.volume}%` : ''}${patch.volume !== undefined && patch.mute !== undefined ? ', ' : ''}${patch.mute !== undefined ? (patch.mute ? 'muted for them' : 'unmuted') : ''}.`
}

async function discordCallsFor(args: Args): Promise<string> {
  const calls = (await window.api.discordCalls()).sort((a, b) => b.start - a.start).slice(0, Math.min(100, num(args.limit, 15)))
  if (!calls.length) return 'No calls saved yet.'
  return calls
    .map(
      (c) =>
        `[${c.id}] ${new Date(c.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}, ${c.channel}${c.server ? ` (${c.server})` : ''}, ${minutes(c.end - c.start)}, with ${c.people.join(', ') || 'nobody'}${c.note ? `\n  Note: ${c.note.replace(/\n/g, ' / ')}` : ''}`
    )
    .join('\n')
}

async function discordNoteFor(args: Args): Promise<string> {
  const text = str(args.text)
  const id = str(args.call_id)
  if (id) {
    const calls = await window.api.discordCalls()
    const call = calls.find((c) => c.id === id)
    if (!call) throw new Error('There’s no call with that id (see discord_calls).')
    await window.api.discordSetCallNote(id, args.append === true && call.note ? `${call.note}\n${text}` : text)
    return `Saved the note on the call in ${call.channel}.`
  }
  const s = await discord()
  if (!s.channel) throw new Error('They’re not in a call. Give call_id to change a past call’s note.')
  const before = args.append === true ? await window.api.discordNote().catch(() => '') : ''
  await window.api.discordSetNote(before ? `${before}\n${text}` : text, s.channel.id)
  return 'Saved the call note (it’s on the call pop-out, and kept with the call afterwards).'
}

// ---------- the phone ----------

function sendToPhoneFor(args: Args): string {
  if (str(args.url)) {
    sendToPhone({ kind: 'link', url: str(args.url) })
    return 'Orbit is showing a code to scan with the phone’s camera; the link opens on the phone.'
  }
  needNotes()
  const path = str(args.path) ? str(args.path).replace(/^\/+/, '') : findNote(str(args.note))
  if (locked(path)) throw new Error('That’s in a locked folder.')
  sendToPhone({ kind: 'file', path })
  return `Orbit is showing a code to scan with the phone’s camera; ${path} goes to the phone (the phone has to be on the same Wi-Fi).`
}

async function phoneAlertFor(args: Args): Promise<string> {
  const title = str(args.title).trim().slice(0, 80) || 'Orbit'
  const body = str(args.message).trim().slice(0, 300)
  if (!body) throw new Error('Say what the alert says.')
  await window.api.phoneNotify(title, body)
  return 'Sent the alert to their phone (if a phone is paired with Orbit).'
}

// ---------- the web ----------

function openWebsiteFor(args: Args): string {
  let url = str(args.url).trim()
  if (!url) throw new Error('Say which website.')
  if (!/^https?:\/\//i.test(url)) url = /\s/.test(url) || !/\./.test(url) ? `https://duckduckgo.com/?q=${encodeURIComponent(url)}` : `https://${url}`
  openWebTab(url, { privately: args.private === true })
  return `Opened ${url} in Orbit’s browser${args.private === true ? ' (privately)' : ''}.`
}

async function webHistoryFor(args: Args): Promise<string> {
  const hits = await window.api.webHistory(str(args.search), Math.min(100, num(args.limit, 20)))
  if (!hits.length) return 'Nothing like that in Orbit’s browser history.'
  return hits.map((h) => `${new Date(h.visited).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}: ${h.title || h.url} (${h.url})${h.snippet ? `\n  …${h.snippet}…` : ''}`).join('\n')
}

async function bookmarksFor(): Promise<string> {
  const list = await window.api.webBookmarks()
  const folders = new Map(list.filter((b) => b.kind === 'folder').map((b) => [b.id, b.title]))
  const links = list.filter((b) => b.kind === 'link')
  if (!links.length) return 'No bookmarks yet.'
  return links.map((b) => `${b.title} (${b.url})${folders.has(b.parent) ? ` in ${folders.get(b.parent)}` : b.parent === 'bar' ? ' on the bar' : ''}`).join('\n')
}

async function addBookmarkFor(args: Args): Promise<string> {
  let url = str(args.url).trim()
  if (!url) throw new Error('Say the address.')
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  const list = await window.api.webBookmarks()
  if (list.some((b) => b.url === url)) return 'That’s already bookmarked.'
  const title = str(args.title).trim() || new URL(url).hostname.replace(/^www\./, '')
  const mark: Bookmark = { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: 'link', title, url, parent: 'bar', created: Date.now() }
  await window.api.webSetBookmarks([...list, mark])
  return `Bookmarked ${title} on the bookmarks bar.`
}

// ---------- wikis ----------

async function wikis(): Promise<Awaited<ReturnType<typeof window.api.wikiList>>> {
  const list = await window.api.wikiList()
  if (!list.length) throw new Error('No wikis are downloaded in Orbit yet (add one on the Wiki page).')
  return list
}

async function wikiSearchFor(args: Args): Promise<string> {
  const list = await wikis()
  const which = str(args.wiki) ? [pickOne(list, str(args.wiki), (w) => w.name, 'wiki')] : list
  const hits = (await Promise.all(which.map((w) => window.api.wikiSearch(w.id, str(args.query)).catch(() => [])))).flat().slice(0, 20)
  if (!hits.length) return 'Nothing found in the wikis.'
  return hits.map((h) => `${h.wikiName}: ${h.shown}${h.section ? ` › ${h.section}` : ''}\n  ${h.snippet}`).join('\n')
}

async function wikiPageFor(args: Args): Promise<string> {
  const list = await wikis()
  const w = str(args.wiki) ? pickOne(list, str(args.wiki), (x) => x.name, 'wiki') : list.length === 1 ? list[0] : null
  if (!w) throw new Error(`Say which wiki: ${list.map((x) => x.name).join(', ')}.`)
  const page = await window.api.wikiPage(w.id, str(args.title))
  if (!page) throw new Error('That page isn’t in the wiki. Use wiki_search to find its title.')
  if (page.blocked) return 'That page is hidden by their spoiler limit.'
  return `${page.displayTitle} (${w.name})\n\n${htmlText(page.html).slice(0, 15_000)}`
}

async function wikiAskFor(args: Args): Promise<string> {
  const list = await wikis()
  const ids = str(args.wiki) ? [pickOne(list, str(args.wiki), (x) => x.name, 'wiki').id] : list.map((w) => w.id)
  const a = await window.api.wikiAsk(str(args.question), ids)
  if (a.spoilerHidden) return 'The answer was hidden because it would spoil something past where they are.'
  return `${a.text}${a.sources.length ? `\n\nFrom: ${a.sources.map((s) => `${s.title} (${s.wikiName})`).join(', ')}` : ''}`
}

export const CONNECT_ANSWERS: Record<string, Answer> = {
  discord_status: discordStatusFor,
  discord_set: discordSetFor,
  discord_leave: discordLeaveFor,
  discord_user_voice: discordUserFor,
  discord_calls: discordCallsFor,
  discord_call_note: discordNoteFor,
  send_to_phone: sendToPhoneFor,
  phone_alert: phoneAlertFor,
  open_website: openWebsiteFor,
  web_history: webHistoryFor,
  get_bookmarks: bookmarksFor,
  add_bookmark: addBookmarkFor,
  wiki_search: wikiSearchFor,
  wiki_page: wikiPageFor,
  wiki_ask: wikiAskFor
}
