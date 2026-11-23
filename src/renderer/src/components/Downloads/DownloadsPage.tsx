import { Music2 } from 'lucide-react'
import { LOCAL_AUDIO } from '@shared/localMusic'
import { importSongs } from '../../store/musicFiles'
import { useVault } from '../../store/vault'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Cpu,
  ExternalLink,
  FileInput,
  FileDown,
  Folder,
  Gamepad2,
  FolderOpen,
  Globe,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Sun,
  Trash2,
  Video,
  X,
  Zap
} from 'lucide-react'
import type { LocalAiState, VideoDownload, VideoDownloaderState } from '@shared/types'
import type { WebDownload } from '@shared/browser'
import { DOWNLOAD_QUALITIES, type DownloadQuality } from '@shared/videoDownload'
import { localModelById } from '@shared/localAi'
import { steamAppIdFromLink, type EpicDownload, type SteamDownload } from '@shared/games'
import {
  clockText,
  isVideoPage,
  parseLinks,
  progressOf,
  sizeText,
  speedText,
  timeLeft,
  type DmItem,
  type DmSettings,
  type DmState
} from '@shared/downloadManager'
import { useBrowser } from '../../store/browser'
import { usePrefs } from '../../store/prefs'
import { notify } from '../../store/notify'
import { showInFiles } from '../../store/filesReveal'
import { openVaultVideo } from '../../store/videoPlayer'
import { insertIntoActiveNote, openFileTab } from '../../lib/editorController'
import { openDownload } from '../Web/Downloads'
import FolderPicker from '../Web/FolderPicker'
import { SaveTo, SetupBox } from './videoParts'
import { addonOn } from '../../lib/addons'

/**
 * The download manager tab: paste links and they download a few at a time, in order. Each one can
 * be paused and carried on where it stopped (even after Orbit closes), moved up or down, or left
 * for the night. Below the queue are the other downloads going on in Orbit (web tabs, the video
 * downloader, the offline AI) so everything downloading is in one place. The work is done in
 * main/downloadManager.ts, so it carries on with this tab closed.
 */

const VIDEO_FOLDER_KEY = 'orbit.videoDownloader.folder'
const FILE_FOLDER_KEY = 'orbit.downloads.folder'

const SPEED_LIMITS: { kb: number; label: string }[] = [
  { kb: 0, label: 'No limit' },
  { kb: 512, label: '0.5 MB/s' },
  { kb: 1024, label: '1 MB/s' },
  { kb: 2048, label: '2 MB/s' },
  { kb: 5120, label: '5 MB/s' },
  { kb: 10240, label: '10 MB/s' },
  { kb: 25600, label: '25 MB/s' }
]

const folderName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

/** "in 5 hr 20 min" until a time. */
function untilText(at: number, now = Date.now()): string {
  const m = Math.max(1, Math.round((at - now) / 60_000))
  if (m < 60) return `in ${m} min`
  const h = Math.floor(m / 60)
  return `in ${h} hr${m % 60 ? ` ${m % 60} min` : ''}`
}

function statusText(d: DmItem, state: DmState): string {
  const p = progressOf(d)
  const sizes = d.total ? `${sizeText(d.received)} of ${sizeText(d.total)}` : d.received ? sizeText(d.received) : ''
  switch (d.status) {
    case 'downloading':
      if (d.kind === 'video') return [d.stage, p !== null && d.stage?.startsWith('Downloading') ? `${Math.round(p * 100)}%` : ''].filter(Boolean).join(' · ')
      return [sizes, d.speed ? speedText(d.speed) : 'Starting…', timeLeft(d.total - d.received, d.speed)].filter(Boolean).join(' · ')
    case 'queued':
      if (d.overnight && !state.night) return `Waiting for tonight (${clockText(state.settings.nightStart)})${sizes ? ` · ${sizes} so far` : ''}`
      return `Waiting its turn${sizes ? ` · ${sizes} so far` : ''}`
    case 'paused':
      return `Paused${sizes ? ` · ${sizes}` : ''}${d.kind === 'video' ? ' · videos start over when they carry on' : d.received && d.resumable === false ? ' · this site can’t carry on, so it starts over' : ''}`
    case 'done':
      return [d.total ? sizeText(d.total) : '', d.kind === 'video' ? `in ${d.path?.split('/').slice(0, -1).join('/') || 'your notes folder'}` : `in ${folderName(d.folder)}`].filter(Boolean).join(' · ')
    case 'failed':
      return d.error ?? 'Didn’t work'
  }
}

function Bar({ value }: { value: number | null }) {
  return (
    <div className="vdl-bar">
      <div className={value === null ? 'vdl-bar-busy' : ''} style={{ width: value === null ? undefined : `${value * 100}%` }} />
    </div>
  )
}

const isSong = (path: string): boolean => LOCAL_AUDIO.some((ext) => path.toLowerCase().endsWith(ext))

/** A downloaded song goes into your music folder too (videos are kept in the notes folder). */
async function addToMusic(d: DmItem): Promise<void> {
  if (!d.path) return
  const full = d.kind === 'video' ? `${useVault.getState().vault}/${d.path}` : d.path
  await importSongs([full])
}

function openItem(d: DmItem): void {
  if (!d.path) return
  if (d.kind === 'video') {
    if (d.quality === 'audio' || !addonOn('video-player')) openFileTab(d.path)
    else openVaultVideo(d.path)
    return
  }
  openDownload({ path: d.path, name: d.name } as WebDownload)
}

function QueueItem({ d, state, first, last }: { d: DmItem; state: DmState; first: boolean; last: boolean }) {
  const act = (action: Parameters<typeof window.api.downloadsAct>[1]): void => void window.api.downloadsAct(d.id, action).catch(notify)
  const busy = d.status === 'downloading'
  const waitingForNight = d.status === 'queued' && d.overnight && !state.night
  const Icon = d.kind === 'video' ? Video : FileDown
  return (
    <li className={`convert-item dm-item ${d.status}`} data-dm-item={d.status}>
      <Icon size={16} className="convert-kind" />
      <div className="convert-name">
        <span title={d.url}>
          {d.name}
          {d.overnight && d.status !== 'done' && <Moon size={12} className="dm-moon" aria-label="Overnight" />}
        </span>
        <small>{statusText(d, state)}</small>
        {(busy || ((d.status === 'paused' || d.status === 'queued') && d.received > 0)) && (
          <div className="vdl-progress">
            <Bar value={busy && d.kind === 'video' && !d.stage?.startsWith('Downloading') ? null : progressOf(d)} />
            {progressOf(d) !== null && <span className="vdl-percent">{Math.round((progressOf(d) ?? 0) * 100)}%</span>}
          </div>
        )}
      </div>
      <div className="vdl-actions">
        {(d.status === 'queued' || d.status === 'paused') && !busy && (
          <>
            <button className="icon-btn" title="Move up" disabled={first} onClick={() => act('up')} data-dm-up>
              <ArrowUp size={14} />
            </button>
            <button className="icon-btn" title="Move down" disabled={last} onClick={() => act('down')}>
              <ArrowDown size={14} />
            </button>
          </>
        )}
        {(waitingForNight || (d.status === 'paused' && d.overnight)) && (
          <button className="btn dm-small" title="Start it as soon as there’s room, not tonight" onClick={() => act('now')} data-dm-now>
            <Zap size={13} /> Now
          </button>
        )}
        {!d.overnight && (d.status === 'queued' || d.status === 'paused' || busy) && (
          <button className="icon-btn" title={`Leave it for tonight (${clockText(state.settings.nightStart)}–${clockText(state.settings.nightEnd)})`} onClick={() => act('tonight')} data-dm-tonight>
            <Moon size={14} />
          </button>
        )}
        {(busy || (d.status === 'queued' && !waitingForNight)) && (
          <button className="icon-btn" title="Pause" onClick={() => act('pause')} data-dm-pause>
            <Pause size={14} />
          </button>
        )}
        {d.status === 'paused' && (
          <button className="icon-btn" title="Carry on" onClick={() => act('resume')} data-dm-resume>
            <Play size={14} />
          </button>
        )}
        {d.status === 'failed' && (
          <button className="icon-btn" title="Try again" onClick={() => act('retry')} data-dm-retry>
            <RotateCcw size={14} />
          </button>
        )}
        {d.status === 'done' && d.path && (
          <>
            <button className="icon-btn" title="Open (inside Orbit where it can)" onClick={() => openItem(d)} data-dm-open>
              <ExternalLink size={14} />
            </button>
            {d.kind === 'video' && (
              <button
                className="icon-btn"
                title="Put it in the note that's open"
                onClick={() => {
                  if (!insertIntoActiveNote(d.path!)) notify('Open a note in the other side first, then try again.', 'info')
                }}
                data-dm-insert
              >
                <FileInput size={14} />
              </button>
            )}
            {isSong(d.path) && addonOn('music') && (
              <button className="icon-btn" title="Add to my music (copies it into your music folder)" onClick={() => void addToMusic(d)} data-dm-to-music>
                <Music2 size={14} />
              </button>
            )}
            <button
              className="icon-btn"
              title="Show in folder"
              onClick={() => (d.kind === 'video' ? void window.api.reveal(d.path!).catch(notify) : showInFiles(d.path!))}
            >
              <FolderOpen size={14} />
            </button>
          </>
        )}
        <button className="icon-btn" title={d.status === 'done' ? 'Take off the list (the file stays)' : 'Cancel and take off the list'} onClick={() => act('remove')} data-dm-remove>
          {d.status === 'done' ? <Trash2 size={13} /> : <X size={14} />}
        </button>
      </div>
    </li>
  )
}

function Settings({ state }: { state: DmState }) {
  const s = state.settings
  const set = (patch: Partial<DmSettings>): void => void window.api.downloadsSettings(patch).catch(notify)
  return (
    <div className="dm-settings" data-dm-settings>
      <label>
        Overnight from
        <input type="time" className="text-input" value={s.nightStart} onChange={(e) => e.target.value && set({ nightStart: e.target.value })} data-dm-night-start />
        to
        <input type="time" className="text-input" value={s.nightEnd} onChange={(e) => e.target.value && set({ nightEnd: e.target.value })} data-dm-night-end />
      </label>
      <label className="dm-check">
        <input type="checkbox" checked={s.pauseAtNightEnd} onChange={(e) => set({ pauseAtNightEnd: e.target.checked })} />
        Pause unfinished overnight downloads in the morning (they carry on the next night)
      </label>
      <label>
        At the same time
        <select className="select" value={s.atOnce} onChange={(e) => set({ atOnce: Number(e.target.value) })} data-dm-at-once>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n === 1 ? 'One at a time' : `${n} downloads`}
            </option>
          ))}
        </select>
      </label>
      <label>
        Speed limit
        <select className="select" value={s.speedLimitKb} onChange={(e) => set({ speedLimitKb: Number(e.target.value) })} data-dm-speed>
          {(SPEED_LIMITS.some((l) => l.kb === s.speedLimitKb) ? SPEED_LIMITS : [...SPEED_LIMITS, { kb: s.speedLimitKb, label: `${s.speedLimitKb} KB/s` }]).map((l) => (
            <option key={l.kb} value={l.kb}>
              {l.label}
            </option>
          ))}
        </select>
        <small>for files in this queue (keeps games and calls smooth)</small>
      </label>
    </div>
  )
}

/** The other downloads going on in Orbit, so everything downloading is in one place. */
type SteamRow = SteamDownload & { speed?: number }

/** Steam's own downloads, read from its files every few seconds while this page is open. */
function useSteamDownloads(): SteamRow[] {
  const [list, setList] = useState<SteamRow[]>([])
  useEffect(() => {
    let alive = true
    const look = (): void => void window.api.steamDownloads().then((l) => alive && setList(l)).catch(() => undefined)
    look()
    const t = setInterval(look, 3000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  return list
}

type EpicRow = EpicDownload & { speed?: number }

/** The Epic Games Launcher's downloads, measured from the games' folders while this page is open. */
function useEpicDownloads(): EpicRow[] {
  const [list, setList] = useState<EpicRow[]>([])
  useEffect(() => {
    let alive = true
    const look = (): void => void window.api.epicDownloads().then((l) => alive && setList(l)).catch(() => undefined)
    look()
    const t = setInterval(look, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  return list
}

const epicStateText = (g: EpicDownload): string =>
  g.state === 'downloading' ? (g.kind === 'update' ? 'Updating in Epic' : 'Downloading in Epic') : 'Paused or waiting in Epic’s queue'

const STEAM_STATE: Record<SteamDownload['state'], string> = { downloading: 'Downloading in Steam', paused: 'Paused in Steam', waiting: 'Waiting in Steam’s queue' }

function Elsewhere({ videos, ai }: { videos: VideoDownload[]; ai: LocalAiState | null }) {
  const steam = useSteamDownloads()
  const epic = useEpicDownloads()
  const web = useBrowser((s) => s.downloads).filter((d) => d.state === 'downloading' || d.state === 'paused')
  const vids = videos.filter((v) => !v.manager && v.status === 'working')
  const aiBusy = ai && (ai.state === 'downloading' || (ai.state === 'missing' && ai.error?.startsWith('Download paused')))
  if (!web.length && !vids.length && !aiBusy && !steam.length && !epic.length) return null

  const laterTonight = (d: WebDownload): void => {
    const folder = d.path ? d.path.replace(/[\\/][^\\/]*$/, '') : undefined
    void window.api
      .downloadsAdd({ urls: [d.url], kind: 'file', folder, overnight: true })
      .then(() => window.api.webDownloadCancel(d.id))
      .then(() => notify('Moved to the queue. It downloads tonight.', 'info'))
      .catch(notify)
  }

  return (
    <section className="dm-elsewhere" data-dm-elsewhere>
      <h3>Elsewhere in Orbit</h3>
      <ul className="convert-list">
        {web.map((d) => {
          const p = d.total ? d.received / d.total : null
          return (
            <li key={d.id} className="convert-item" data-dm-web>
              <Globe size={16} className="convert-kind" />
              <div className="convert-name">
                <span title={d.url}>{d.name}</span>
                <small>
                  From a web tab · {d.state === 'paused' ? 'Paused · ' : ''}
                  {sizeText(d.received)}
                  {d.total ? ` of ${sizeText(d.total)}` : ''}
                </small>
                <div className="vdl-progress">
                  <Bar value={p} />
                </div>
              </div>
              <div className="vdl-actions">
                <button className="icon-btn" title="Stop it here and download it tonight in the queue instead" onClick={() => laterTonight(d)} data-dm-web-tonight>
                  <Moon size={14} />
                </button>
                <button className="icon-btn" title={d.state === 'paused' ? 'Carry on' : 'Pause'} onClick={() => void window.api.webDownloadPause(d.id, d.state !== 'paused')}>
                  {d.state === 'paused' ? <Play size={14} /> : <Pause size={14} />}
                </button>
                <button className="icon-btn" title="Cancel" onClick={() => void window.api.webDownloadCancel(d.id)}>
                  <X size={14} />
                </button>
              </div>
            </li>
          )
        })}
        {steam.map((g) => (
          <li key={g.appId} className="convert-item" data-dm-steam={g.state}>
            <Gamepad2 size={16} className="convert-kind" />
            <div className="convert-name">
              <span>{g.name}</span>
              <small>
                {[
                  STEAM_STATE[g.state],
                  g.total ? `${sizeText(g.downloaded)} of ${sizeText(g.total)}` : '',
                  g.speed ? speedText(g.speed) : '',
                  g.total && g.speed ? timeLeft(g.total - g.downloaded, g.speed) : ''
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
              <div className="vdl-progress">
                <Bar value={g.total ? g.downloaded / g.total : g.state === 'downloading' ? null : 0} />
                {g.total > 0 && <span className="vdl-percent">{Math.round((g.downloaded / g.total) * 100)}%</span>}
              </div>
            </div>
            <div className="vdl-actions">
              <button className="btn dm-small" title="Pause, reorder or schedule it in Steam's Downloads page" onClick={() => void window.api.steamOpenDownloads().catch(notify)}>
                Open in Steam
              </button>
            </div>
          </li>
        ))}
        {epic.map((g) => (
          <li key={`epic:${g.appName}`} className="convert-item" data-dm-epic={g.state}>
            <Gamepad2 size={16} className="convert-kind" />
            <div className="convert-name">
              <span>{g.name}</span>
              <small>
                {[
                  epicStateText(g),
                  g.total ? `${sizeText(g.downloaded)} of ${sizeText(g.total)}` : g.downloaded ? `${sizeText(g.downloaded)} so far` : '',
                  g.speed ? speedText(g.speed) : '',
                  g.total && g.speed ? timeLeft(g.total - g.downloaded, g.speed) : ''
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
              <div className="vdl-progress">
                <Bar value={g.total ? g.downloaded / g.total : g.state === 'downloading' ? null : 0} />
                {g.total > 0 && <span className="vdl-percent">{Math.round((g.downloaded / g.total) * 100)}%</span>}
              </div>
            </div>
            <div className="vdl-actions">
              <button className="btn dm-small" title="Pause, reorder or cancel it in the Epic Games Launcher" onClick={() => void window.api.epicOpenDownloads().catch(notify)}>
                Open in Epic
              </button>
            </div>
          </li>
        ))}
        {vids.map((v) => (
          <li key={v.id} className="convert-item" data-dm-video>
            <Video size={16} className="convert-kind" />
            <div className="convert-name">
              <span title={v.url}>{v.title ?? v.url}</span>
              <small>Video downloader · {v.site}</small>
              <div className="vdl-progress">
                <Bar value={v.stage === 'video' || v.stage === 'sound' ? (v.progress ?? null) : null} />
              </div>
            </div>
            <div className="vdl-actions">
              <button className="icon-btn" title="Cancel" onClick={() => void window.api.cancelVideoDownload(v.id)}>
                <X size={14} />
              </button>
            </div>
          </li>
        ))}
        {aiBusy && ai && (
          <li className="convert-item" data-dm-ai>
            <Cpu size={16} className="convert-kind" />
            <div className="convert-name">
              <span>Offline AI{localModelById(ai.model)?.name ? ` (${localModelById(ai.model)!.name})` : ''}</span>
              <small>
                {ai.state === 'downloading'
                  ? `${ai.stage === 'engine' ? 'The AI engine' : 'The AI model'}${ai.bytes ? ` · ${sizeText(Math.round((ai.progress ?? 0) * ai.bytes))} of ${sizeText(ai.bytes)}` : ''}`
                  : 'Paused · carries on where it stopped'}
              </small>
              <div className="vdl-progress">
                <Bar value={ai.state === 'downloading' ? (ai.progress ?? null) : 0} />
              </div>
            </div>
            <div className="vdl-actions">
              {ai.state === 'downloading' ? (
                <button className="icon-btn" title="Pause" onClick={() => void window.api.localAiCancel()}>
                  <Pause size={14} />
                </button>
              ) : (
                <button className="icon-btn" title="Carry on" onClick={() => void window.api.localAiInstall(ai.model ?? ai.suggested).catch(notify)}>
                  <Play size={14} />
                </button>
              )}
            </div>
          </li>
        )}
      </ul>
    </section>
  )
}

export default function DownloadsPage() {
  const [state, setState] = useState<DmState | null>(null)
  const [videos, setVideos] = useState<VideoDownload[]>([])
  const [ai, setAi] = useState<LocalAiState | null>(null)
  const [setup, setSetup] = useState<VideoDownloaderState | null>(null)
  const [text, setText] = useState('')
  const [quality, setQuality] = useState<DownloadQuality>('1080')
  const [fileFolder, setFileFolder] = useState<string | null>(() => localStorage.getItem(FILE_FOLDER_KEY))
  const [picking, setPicking] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const attachments = usePrefs((s) => s.prefs.attachmentFolder)
  const [videoFolder, setVideoFolder] = useState<string | null>(() => localStorage.getItem(VIDEO_FOLDER_KEY))
  const input = useRef<HTMLTextAreaElement>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    void window.api.downloadsState().then(setState)
    void window.api.videoDownloads().then(setVideos)
    void window.api.localAiState().then(setAi)
    void window.api.videoDownloaderState().then(setSetup)
    const d = window.api.onVideoDownloaderState(setSetup)
    const a = window.api.onDownloadsState(setState)
    const b = window.api.onVideoDownloads(setVideos)
    const c = window.api.onLocalAiState(setAi)
    // "Starts in 5 hr" stays right.
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    input.current?.focus()
    return () => {
      a()
      b()
      c()
      d()
      clearInterval(t)
    }
  }, [])

  // Steam store links go to Steam itself (a store page isn't a file to download).
  const steamIds = useMemo(() => [...new Set(text.split(/\s+/).map(steamAppIdFromLink).filter((id): id is string => !!id))], [text])
  const links = useMemo(() => parseLinks(text).filter((l) => !steamAppIdFromLink(l)), [text])
  const videoLinks = links.filter(isVideoPage).length
  const folder = fileFolder || state?.defaultFolder || ''

  const installSteam = (): void => {
    for (const id of steamIds) void window.api.steamInstall(id).catch(notify)
    notify('Steam is asking where to install it. Once it starts, it shows here under Steam.', 'info')
    if (!links.length) setText('')
  }

  const add = (overnight: boolean): void => {
    if (steamIds.length) installSteam()
    if (!links.length) {
      if (steamIds.length) return
      notify('Paste a link first: the address of the file (or video) to download.')
      return
    }
    void window.api
      .downloadsAdd({ urls: links, folder, videoFolder: videoFolder ?? attachments, quality, overnight })
      .then((added) => {
        setText('')
        if (overnight && state && !state.night) notify(`${added.length === 1 ? 'It downloads' : `${added.length} downloads start`} tonight at ${clockText(state.settings.nightStart)}.`, 'info')
      })
      .catch(notify)
  }

  if (!state) return <div className="convert-page" data-dm-page />

  const items = state.items
  const queue = items.filter((i) => i.status !== 'done')
  const done = items.filter((i) => i.status === 'done').sort((a, b) => (b.finished ?? 0) - (a.finished ?? 0))
  const running = items.filter((i) => i.status === 'downloading')
  const speed = running.reduce((n, i) => n + (i.speed ?? 0), 0)
  const tonight = queue.filter((i) => i.overnight).length
  const anyPaused = queue.some((i) => i.status === 'paused')
  const anyGoing = queue.some((i) => i.status === 'downloading' || (i.status === 'queued' && !(i.overnight && !state.night)))

  return (
    <div className="convert-page" data-dm-page>
      <div className="convert-inner">
        <h2>
          <ArrowDownToLine size={18} /> Downloads
        </h2>
        <p className="convert-intro">
          Paste links to files, or to videos on YouTube, X, Instagram, TikTok, Reddit, Twitch and more, and they download in order, {state.settings.atOnce === 1 ? 'one at a time' : `${state.settings.atOnce} at a time`}. Pause any of them and carry on later,
          even after closing Orbit, or leave big ones for the night.
        </p>

        <div className="dm-add">
          <textarea
            ref={input}
            className="text-input dm-links"
            rows={Math.min(6, Math.max(1, text.split('\n').length))}
            placeholder="Paste one or more links…"
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                add(false)
              }
            }}
            data-dm-links
          />
          <div className="dm-add-row">
            <div className="vdl-saveto dm-folder">
              <span className="vdl-saveto-label">Files go to</span>
              <button type="button" className="btn vdl-saveto-btn" title={folder} onClick={() => setPicking(!picking)} data-dm-folder>
                <Folder size={13} /> <span>{folderName(folder)}</span> <ChevronDown size={13} />
              </button>
              {picking && (
                <div className="dm-folder-menu">
                  <FolderPicker
                    start={folder}
                    pickLabel="Download here"
                    onCancel={() => setPicking(false)}
                    onPick={(f) => {
                      setFileFolder(f)
                      localStorage.setItem(FILE_FOLDER_KEY, f)
                      setPicking(false)
                    }}
                  />
                </div>
              )}
            </div>
            <span className="convert-spacer" />
            <button className="btn" disabled={!links.length} onClick={() => add(true)} title={`Starts at ${clockText(state.settings.nightStart)}`} data-dm-add-tonight>
              <Moon size={13} /> Tonight
            </button>
            <button className="btn btn-primary" disabled={!links.length && !steamIds.length} onClick={() => add(false)} data-dm-add>
              <ArrowDownToLine size={13} /> Download{links.length > 1 ? ` ${links.length}` : ''}
            </button>
          </div>
          {steamIds.length > 0 && (
            <div className="dm-video-row" data-dm-steam-options>
              <Gamepad2 size={14} />
              <span>
                {steamIds.length === 1 ? 'That’s a Steam game' : `${steamIds.length} Steam games`}: Download opens Steam’s install window (Steam asks which drive), then its progress shows here. For
                overnight, use Steam’s own <em>Settings → Downloads → Schedule auto-updates</em>, as Orbit can’t press Steam’s buttons.
              </span>
            </div>
          )}
          {videoLinks > 0 && (
            <div className="dm-video-row" data-dm-video-options>
              <Video size={14} />
              <span>
                {videoLinks === links.length ? (videoLinks === 1 ? 'That’s a video page' : 'Those are video pages') : `${videoLinks} of those are video pages`}: Orbit saves the video itself, not the page.
              </span>
              <select className="select" value={quality} onChange={(e) => setQuality(e.target.value as DownloadQuality)}>
                {DOWNLOAD_QUALITIES.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
              <SaveTo
                folder={videoFolder ?? attachments}
                onPick={(f) => {
                  setVideoFolder(f)
                  localStorage.setItem(VIDEO_FOLDER_KEY, f)
                }}
              />
            </div>
          )}
          {videoLinks > 0 && setup && <SetupBox setup={setup} onGet={() => void window.api.getVideoDownloader().then(setSetup).catch(notify)} />}
        </div>

        <div className={`dm-night ${state.night ? 'on' : ''}`} data-dm-night>
          {state.night ? <Moon size={15} /> : <Sun size={15} />}
          <span>
            {state.night
              ? `Overnight hours now, until ${clockText(state.settings.nightEnd)}.`
              : `Overnight hours: ${clockText(state.settings.nightStart)} to ${clockText(state.settings.nightEnd)}, starting ${untilText(state.nextChange)}.`}
            {tonight > 0 && !state.night && ` ${tonight} waiting for tonight.`}
            {' Leave Orbit open (it can be in the tray) and the computer awake.'}
          </span>
          <button className="icon-btn" title="Overnight hours, how many at once, speed limit" onClick={() => setShowSettings(!showSettings)} data-dm-settings-btn>
            <Settings2 size={15} />
          </button>
        </div>
        {showSettings && <Settings state={state} />}

        <div className="dm-head">
          <h3>Queue</h3>
          {running.length > 0 && <span className="dm-speed">{speed ? speedText(speed) : ''}</span>}
          <span className="convert-spacer" />
          {anyGoing && (
            <button className="btn dm-small" onClick={() => void window.api.downloadsAll('pause')} data-dm-pause-all>
              <Pause size={13} /> Pause all
            </button>
          )}
          {anyPaused && (
            <button className="btn dm-small" onClick={() => void window.api.downloadsAll('resume')} data-dm-resume-all>
              <Play size={13} /> Carry on all
            </button>
          )}
        </div>
        {queue.length ? (
          <ul className="convert-list dm-list">
            {queue.map((d, i) => (
              <QueueItem key={d.id} d={d} state={state} first={i === 0} last={i === queue.length - 1} />
            ))}
          </ul>
        ) : (
          <p className="dm-empty">Nothing waiting. Paste a link above to start.</p>
        )}

        <Elsewhere videos={videos} ai={ai} />

        {done.length > 0 && (
          <section data-dm-done>
            <div className="dm-head">
              <h3>Finished</h3>
              <span className="convert-spacer" />
              <button className="btn dm-small" onClick={() => void window.api.downloadsAll('clear')} data-dm-clear>
                Clear the list
              </button>
            </div>
            <ul className="convert-list dm-list">
              {done.map((d, i) => (
                <QueueItem key={d.id} d={d} state={state} first={i === 0} last={i === done.length - 1} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
