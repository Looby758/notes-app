import type { FileNode } from '@shared/types'
import { formatTime, isVideoFile } from '@shared/videoPlayer'
import { episodeLabel, episodeOf, sameShow, showEpisodes, type Episode } from '@shared/videoEpisodes'
import { useVault } from '../../store/vault'
import { closeVideo, openVideo, playNext, remember, useVideoPlayer, videoCommand, watchedOf, type VideoCommand, type Watched } from '../../store/videoPlayer'
import { locked, needNotes, num, pickOne, str, type Answer, type Args } from './common'

/**
 * The video player for Claude Desktop: finding videos in the notes folder, playing one (or an
 * episode of a show: "season 2 episode 3", "the next episode"), Up next, and controlling the
 * video that's playing.
 */

interface Video {
  /** Path in the notes folder. */
  path: string
  name: string
  full: string
}

const slash = (p: string): string => p.replace(/\\/g, '/')

function videos(): Video[] {
  needNotes()
  const root = slash(useVault.getState().vault).replace(/\/$/, '')
  const out: Video[] = []
  const walk = (nodes: FileNode[]): void => {
    for (const n of nodes) {
      if (n.children) walk(n.children)
      else if (isVideoFile(n.name) && !locked(n.path)) out.push({ path: n.path, name: n.name, full: `${root}/${n.path}` })
    }
  }
  walk(useVault.getState().tree)
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
}

/** What's remembered about a video from the notes folder (history paths are full paths). */
function watched(v: Video): Watched | undefined {
  const tail = `/${slash(v.path)}`.toLowerCase()
  const here = useVideoPlayer.getState().history.find((h) => slash(h.path).toLowerCase().endsWith(tail))
  return here ?? watchedOf(v.full)
}

function progress(v: Video): string {
  const w = watched(v)
  if (!w) return 'not watched'
  if (w.at > 0) return `stopped at ${formatTime(w.at)}${w.duration ? ` of ${formatTime(w.duration)}` : ''}`
  return 'watched'
}

/** Plays a video from the notes folder; `fromStart` forgets where it was left. */
async function play(v: Video, fromStart: boolean): Promise<void> {
  const full = await window.api.videoInVault(v.path)
  if (fromStart) remember(full, { at: 0 })
  openVideo(full)
}

function findVideosFor(args: Args): string {
  const q = str(args.search).trim().toLowerCase()
  const list = videos().filter((v) => !q || v.path.toLowerCase().includes(q) || q.split(/\s+/).every((w) => v.path.toLowerCase().includes(w)))
  if (!list.length) return q ? `No videos in the notes folder match “${str(args.search)}”.` : 'There are no videos in the notes folder.'
  const limit = Math.min(300, num(args.limit, 60))
  return (
    list
      .slice(0, limit)
      .map((v) => {
        const e = episodeOf(v.path)
        return `${v.path}${e ? ` [${e.show} ${episodeLabel(e)}]` : ''} (${progress(v)})`
      })
      .join('\n') + (list.length > limit ? `\n…and ${list.length - limit} more.` : '')
  )
}

function showsFor(): string {
  const shows = new Map<string, { name: string; count: number }>()
  for (const v of videos()) {
    const e = episodeOf(v.path)
    if (!e) continue
    const key = e.show.toLowerCase().replace(/[^a-z0-9]/g, '')
    const s = shows.get(key) ?? { name: e.show, count: 0 }
    s.count++
    shows.set(key, s)
  }
  return shows.size ? [...shows.values()].map((s) => `${s.name}: ${s.count} episode(s)`).join('\n') : 'No TV shows found in the notes folder (videos named like "Show S01E02" or kept in "Season 1" folders).'
}

function episodesOf(show: string): (Video & Episode)[] {
  const all = videos()
  const names = [...new Set(all.map((v) => episodeOf(v.path)?.show).filter((s): s is string => !!s))]
  if (!names.length) throw new Error('No TV shows found in the notes folder.')
  const name = names.find((n) => sameShow(n, show)) ?? pickOne(names, show, (n) => n, 'show')
  return showEpisodes(all, name)
}

function episodesFor(args: Args): string {
  const list = episodesOf(str(args.show))
  return `${list[0].show}:\n${list.map((e) => `${episodeLabel(e)}: ${e.name} (${progress(e)})`).join('\n')}`
}

/** Where they're up to in a show: the episode to carry on with, or the one after the last finished. */
function upTo(list: (Video & Episode)[]): { episode: Video & Episode; why: string } {
  let last: { e: Video & Episode; w: Watched } | null = null
  for (const e of list) {
    const w = watched(e)
    if (w && (!last || w.watched > last.w.watched)) last = { e, w }
  }
  if (!last) return { episode: list[0], why: 'from the first episode (none watched yet)' }
  if (last.w.at > 0) return { episode: last.e, why: `carrying on from ${formatTime(last.w.at)}` }
  const next = list[list.indexOf(last.e) + 1]
  if (!next) throw new Error(`${episodeLabel(last.e)} was the last episode of ${last.e.show} in the notes folder, and it’s been watched.`)
  return { episode: next, why: `the next one after ${episodeLabel(last.e)}` }
}

async function playVideoFor(args: Args): Promise<string> {
  const fromStart = args.from_start === true
  if (str(args.show)) {
    const list = episodesOf(str(args.show))
    let pick: Video & Episode
    let why = ''
    if (typeof args.episode === 'number') {
      const season = typeof args.season === 'number' ? args.season : (list.find((e) => e.episode === args.episode)?.season ?? 1)
      const found = list.find((e) => e.season === season && e.episode === args.episode)
      if (!found) throw new Error(`There’s no ${episodeLabel({ season, episode: args.episode })} of ${list[0].show} in the notes folder. It has: ${list.map(episodeLabel).join(', ')}.`)
      pick = found
    } else if (typeof args.season === 'number') {
      const first = list.find((e) => e.season === args.season)
      if (!first) throw new Error(`There’s no season ${args.season} of ${list[0].show} in the notes folder.`)
      pick = first
    } else {
      ;({ episode: pick, why } = upTo(list))
    }
    await play(pick, fromStart)
    return `Playing ${pick.show} ${episodeLabel(pick)} (${pick.name})${why ? `, ${why}` : ''}${fromStart ? ', from the start' : ''}.`
  }
  const want = str(args.video).trim()
  if (!want) throw new Error('Say which video, or which show.')
  const all = videos()
  const v = all.find((x) => x.path === want) ?? pickOne(all, want, (x) => x.name.replace(/\.[^.]+$/, ''), 'video')
  await play(v, fromStart)
  return `Playing ${v.path}${fromStart ? ' from the start' : watched(v)?.at ? `, carrying on from ${formatTime(watched(v)!.at)}` : ''}.`
}

async function nextEpisodeFor(): Promise<string> {
  const current = useVideoPlayer.getState().current
  if (!current) throw new Error('No video is open. Say which show to carry on with instead.')
  const e = episodeOf(current)
  if (!e) throw new Error('The video that’s open isn’t an episode of a show.')
  const list = episodesOf(e.show)
  const next = list.find((x) => x.season > e.season || (x.season === e.season && x.episode > e.episode))
  if (!next) throw new Error(`${episodeLabel(e)} is the last episode of ${e.show} in the notes folder.`)
  await play(next, false)
  return `Playing ${next.show} ${episodeLabel(next)} (${next.name}).`
}

async function queueVideosFor(args: Args): Promise<string> {
  const all = videos()
  const added: string[] = []
  const queue = [...useVideoPlayer.getState().queue]
  const wanted: Video[] = []
  if (str(args.show)) {
    const list = episodesOf(str(args.show))
    const from = typeof args.from_episode === 'number' ? list.findIndex((e) => e.episode === args.from_episode && (typeof args.season !== 'number' || e.season === args.season)) : 0
    wanted.push(...list.slice(Math.max(0, from), Math.max(0, from) + Math.min(50, num(args.count, 5))))
  }
  for (const w of Array.isArray(args.videos) ? args.videos : []) if (typeof w === 'string') wanted.push(pickOne(all, w, (x) => x.name.replace(/\.[^.]+$/, ''), 'video'))
  if (!wanted.length) throw new Error('Say which videos, or which show.')
  for (const v of wanted) {
    const full = await window.api.videoInVault(v.path)
    if (!queue.includes(full) && useVideoPlayer.getState().current !== full) {
      queue.push(full)
      added.push(v.name)
    }
  }
  useVideoPlayer.setState({ queue })
  return added.length ? `Added to Up next in the video player: ${added.join(', ')}.` : 'Those are already in Up next (or playing).'
}

function upNextFor(): string {
  const s = useVideoPlayer.getState()
  const name = (p: string): string => slash(p).split('/').pop() ?? p
  return `${s.current ? `Open now: ${name(s.current)}` : 'No video is open.'}\nUp next: ${s.queue.length ? s.queue.map((p, i) => `${i + 1}. ${name(p)}`).join(', ') : 'nothing'}`
}

function historyFor(args: Args): string {
  const list = useVideoPlayer.getState().history.slice(0, Math.min(50, num(args.limit, 10)))
  if (!list.length) return 'Nothing has been watched in the video player yet.'
  return list.map((h) => `${h.name}: ${h.at > 0 ? `stopped at ${formatTime(h.at)}${h.duration ? ` of ${formatTime(h.duration)}` : ''}` : 'watched'} (${new Date(h.watched).toLocaleString()})`).join('\n')
}

const ACTIONS: VideoCommand['action'][] = ['status', 'play', 'pause', 'forward', 'back', 'seek', 'restart', 'speed', 'volume', 'mute', 'unmute', 'fullscreen', 'exit_fullscreen']

function controlsFor(args: Args): string {
  const action = str(args.action)
  if (action === 'next') {
    if (!playNext()) throw new Error('Up next is empty. Use play_video, or next_episode for a show.')
    return 'Playing the next video in Up next.'
  }
  if (action === 'close') {
    closeVideo()
    return 'Closed the video.'
  }
  if (!ACTIONS.includes(action as VideoCommand['action'])) throw new Error(`The action has to be one of: ${[...ACTIONS, 'next', 'close'].join(', ')}.`)
  const said = videoCommand({ action: action as VideoCommand['action'], value: typeof args.value === 'number' ? args.value : undefined })
  if (said === null) throw new Error('No video is open in Orbit’s player tab (a video in the pop-out window can’t be controlled from here).')
  return said
}

export const VIDEO_ANSWERS: Record<string, Answer> = {
  find_videos: findVideosFor,
  list_shows: showsFor,
  list_episodes: episodesFor,
  play_video: playVideoFor,
  next_episode: nextEpisodeFor,
  queue_videos: queueVideosFor,
  get_video_queue: upNextFor,
  video_history: historyFor,
  video_controls: controlsFor
}
