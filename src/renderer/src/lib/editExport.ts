import type { SpokenWord } from '@shared/transcribe'
import { clock } from '@shared/transcribe'
import type { Shot } from './shotList'

/**
 * Export for editing: everything a video editor needs for one recording, in a folder of its own.
 *
 *   <Video title> – for editing/
 *     Take 1.m4a                       the recording, as it is
 *     Pictures/01 0-07.6 college.png   every picture cue, numbered in order, with its start time
 *     Shot list.txt                    "0:07 – college.png", with section headings
 *     Shot list.csv                    one row per picture or clip (start, end, length, file…)
 *     Markers (DaVinci Resolve).edl    timeline markers: Timeline → Import → Timeline Markers from EDL
 *     Shots.srt                        the shot list as subtitles: drop it on any editor's timeline
 *     Transcript.srt                   captions of what was said (also fine to upload to YouTube)
 *     Chapters.txt                     YouTube chapters from the sections
 *
 * This file only works out the names and the text; main/transcriber.ts copies the files.
 */

export interface ExportFile {
  name: string
  text: string
}

export interface ExportPicture {
  /** The picture in the notes folder. */
  path: string
  /** Its name in the Pictures folder. */
  name: string
}

export interface ExportPlan {
  folder: string
  pictures: ExportPicture[]
  files: ExportFile[]
}

/** A name that works as a file or folder name on Windows and Mac. */
export const safeName = (name: string): string =>
  name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 100) || 'Video'

/** "0-07.6": a start time that's allowed in a file name (no colons), and sorts the same as the numbers. */
const fileTime = (seconds: number): string => {
  const tenths = Math.round(Math.max(0, seconds) * 10)
  const s = Math.floor(tenths / 10)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = `${String(s % 60).padStart(2, '0')}.${tenths % 10}`
  return h ? `${h}-${String(m).padStart(2, '0')}-${sec}` : `${m}-${sec}`
}

const extOf = (path: string): string => {
  const m = /\.[a-z0-9]{1,5}$/i.exec(path)
  return m ? m[0].toLowerCase() : ''
}
const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.[a-z0-9]{1,5}$/i, '')

/** Timed pictures and clips, in time order. */
const inOrder = (shots: readonly Shot[]): Shot[] => shots.filter((s) => s.kind !== 'SECTION' && s.time !== null).sort((a, b) => a.time! - b.time!)

/** Each picture cue as a numbered copy, in the order they go on screen. `picture` finds a cue's file. */
export function numberedPictures(shots: readonly Shot[], picture: (s: Shot) => string | null): ExportPicture[] {
  const list = inOrder(shots).filter((s) => s.kind === 'IMAGE' && picture(s))
  const width = Math.max(2, String(list.length).length)
  return list.map((s, i) => {
    const path = picture(s)!
    return { path, name: safeName(`${String(i + 1).padStart(width, '0')} ${fileTime(s.time!)} ${baseOf(path)}`) + extOf(path) }
  })
}

const csvCell = (v: string | number): string => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One row per picture or clip, in time order (and the ones that couldn't be timed at the end). */
export function shotCsv(shots: readonly Shot[], pictures: readonly ExportPicture[], picture: (s: Shot) => string | null): string {
  const rows: (string | number)[][] = [['#', 'Start', 'End', 'Seconds on screen', 'Start (seconds)', 'Type', 'Name', 'Section', 'File']]
  let section = ''
  const sectionAt = new Map<string, string>()
  for (const s of shots) {
    if (s.kind === 'SECTION') section = s.value
    else sectionAt.set(s.key, section)
  }
  const timed = inOrder(shots)
  const untimed = shots.filter((s) => s.kind !== 'SECTION' && s.time === null)
  let n = 0
  const used = new Set<ExportPicture>()
  for (const s of [...timed, ...untimed]) {
    n++
    const path = s.kind === 'IMAGE' ? picture(s) : null
    const copy = path && s.time !== null ? pictures.find((p) => p.path === path && !used.has(p)) : undefined
    if (copy) used.add(copy)
    rows.push([
      n,
      s.time === null ? '' : clock(s.time),
      s.time === null || s.length === null ? '' : clock(s.time + s.length),
      s.length === null ? '' : s.length.toFixed(1),
      s.time === null ? '' : s.time.toFixed(2),
      s.kind === 'IMAGE' ? 'Picture' : 'Clip',
      s.value,
      sectionAt.get(s.key) ?? '',
      copy ? `Pictures/${copy.name}` : s.kind === 'IMAGE' ? 'not found' : ''
    ])
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

// ---------- Subtitles ----------

const srtTime = (seconds: number): string => {
  const ms = Math.round(Math.max(0, seconds) * 1000)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}

const srt = (cues: { start: number; end: number; text: string }[]): string =>
  cues.map((c, i) => `${i + 1}\r\n${srtTime(c.start)} --> ${srtTime(Math.max(c.end, c.start + 0.5))}\r\n${c.text}\r\n`).join('\r\n')

/** The shot list as subtitles: each picture or clip shows its name for as long as it's on screen. */
export function shotSrt(shots: readonly Shot[], length: number | null): string {
  return srt(
    inOrder(shots).map((s) => ({
      start: s.time!,
      end: s.length !== null ? s.time! + s.length : (length ?? s.time! + 5),
      text: s.kind === 'CLIP' ? `[CLIP] ${s.value}` : s.value
    }))
  )
}

/** Up to two lines of about this many letters each. */
const LINE = 42
const MAX_SECONDS = 6

/** Captions of what was said: short pieces, broken at the ends of sentences and at pauses. */
export function transcriptSrt(words: readonly SpokenWord[]): string {
  const cues: { start: number; end: number; text: string }[] = []
  let cur: SpokenWord[] = []
  const flush = (): void => {
    if (!cur.length) return
    const text = cur.map((w) => w.w).join(' ')
    // Two lines: split near the middle, at a space.
    let shown = text
    if (text.length > LINE) {
      const mid = text.length / 2
      let at = -1
      for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (at < 0 || Math.abs(i - mid) < Math.abs(at - mid))) at = i
      if (at > 0) shown = `${text.slice(0, at)}\r\n${text.slice(at + 1)}`
    }
    cues.push({ start: cur[0].s, end: cur[cur.length - 1].e, text: shown })
    cur = []
  }
  for (const w of words) {
    const prev = cur[cur.length - 1]
    const length = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length
    if (cur.length && (length > LINE * 2 || w.e - cur[0].s > MAX_SECONDS || (prev && w.s - prev.e > 1))) flush()
    cur.push(w)
    if (/[.?!]["”’)]*$/.test(w.w)) flush()
  }
  flush()
  return srt(cues)
}

// ---------- Timeline markers ----------

/** Frames a second for the markers file (Resolve's default timeline starts at 01:00:00:00). */
export const MARKER_FPS = 30

const timecode = (seconds: number, fps = MARKER_FPS): string => {
  const frames = Math.round(Math.max(0, seconds) * fps) + 3600 * fps
  const f = frames % fps
  const s = Math.floor(frames / fps)
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60, f].map((n) => String(n).padStart(2, '0')).join(':')
}

/**
 * DaVinci Resolve timeline markers (an EDL of markers): blue for pictures, purple for clips, green
 * for sections, each as long as it's on screen. In Resolve: right-click the timeline in the media
 * pool → Timelines → Import → Timeline Markers from EDL.
 */
export function markersEdl(shots: readonly Shot[], title: string, fps = MARKER_FPS): string {
  const lines = [`TITLE: ${title.replace(/[\r\n]/g, ' ')}`, 'FCM: NON-DROP FRAME', '']
  const all = shots.filter((s) => s.time !== null).sort((a, b) => a.time! - b.time!)
  all.forEach((s, i) => {
    const n = String(i + 1).padStart(3, '0')
    const tc = timecode(s.time!, fps)
    const out = timecode(s.time! + 1 / fps, fps)
    const colour = s.kind === 'SECTION' ? 'ResolveColorGreen' : s.kind === 'CLIP' ? 'ResolveColorPurple' : 'ResolveColorBlue'
    const name = (s.kind === 'SECTION' ? `§ ${s.value}` : s.kind === 'CLIP' ? `Clip: ${s.value}` : s.value).replace(/[|\r\n]/g, ' ')
    const frames = s.length !== null && s.kind !== 'SECTION' ? Math.max(1, Math.round(s.length * fps)) : 1
    lines.push(`${n}  001      V     C        ${tc} ${out} ${tc} ${out}  `, ` |C:${colour} |M:${name} |D:${frames}`, '')
  })
  return lines.join('\r\n')
}

/** YouTube chapters from the sections ("0:00 Intro"). YouTube wants the first at 0:00, so it's moved there. */
export function chaptersText(shots: readonly Shot[]): string {
  const sections = shots.filter((s) => s.kind === 'SECTION' && s.time !== null).sort((a, b) => a.time! - b.time!)
  if (!sections.length) return ''
  return sections.map((s, i) => `${clock(i === 0 ? 0 : s.time!)} ${s.value || `Part ${i + 1}`}`).join('\n') + '\n'
}

/** Everything to export for one recording. */
export function exportPlan(opts: {
  title: string
  recordingName: string
  shots: readonly Shot[]
  shotListText: string
  picture: (s: Shot) => string | null
  words: readonly SpokenWord[] | null
  length: number | null
}): ExportPlan {
  const pictures = numberedPictures(opts.shots, opts.picture)
  const files: ExportFile[] = [
    { name: 'Shot list.txt', text: opts.shotListText },
    { name: 'Shot list.csv', text: shotCsv(opts.shots, pictures, opts.picture) },
    { name: 'Markers (DaVinci Resolve).edl', text: markersEdl(opts.shots, opts.title || baseOf(opts.recordingName)) },
    { name: 'Shots.srt', text: shotSrt(opts.shots, opts.length) }
  ]
  if (opts.words?.length) files.push({ name: 'Transcript.srt', text: transcriptSrt(opts.words) })
  const chapters = chaptersText(opts.shots)
  if (chapters) files.push({ name: 'Chapters.txt', text: chapters })
  return { folder: safeName(`${opts.title || baseOf(opts.recordingName)} – for editing`), pictures, files }
}
