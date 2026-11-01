import { useEffect, useState, type ReactNode } from 'react'
import { BookMarked, Check, ClipboardCopy, Loader2, Music2, NotebookPen, Trash2, Type, X } from 'lucide-react'
import type { MusicItem } from '@shared/spotify'
import { chapterAt, markChapter, type ComicChapter, type ComicPlaylist } from '@shared/comics'
import { DestPicker, type Dest } from '../CaptureApp'
import { usePrefs } from '../../store/prefs'
import { saveCapture } from '../../lib/capture'
import { errorMessage, noteTitle } from '../../lib/paths'
import { joinBubbleLines, sentenceCase } from '../../lib/comicPanels'

/** Where the last thing from a comic was saved, so the next one can go there too. */
const DEST_KEY = 'comics:dest'

export function lastDest(): Dest | null {
  try {
    return JSON.parse(localStorage.getItem(DEST_KEY) ?? 'null') as Dest | null
  } catch {
    return null
  }
}

function useDestLabel(): (d: Dest | null) => string {
  const prefs = usePrefs((s) => s.prefs)
  return (d) => {
    const kind = d?.kind ?? prefs.captureTarget
    if (kind === 'daily') return 'Today’s note'
    if (kind === 'inbox') return noteTitle(prefs.captureInbox.endsWith('.md') ? prefs.captureInbox : `${prefs.captureInbox}.md`)
    if (d && 'path' in d) return d.kind === 'folder' ? `A new note in ${d.path || 'the top folder'}` : noteTitle(d.path)
    return 'a note'
  }
}

/** Saves text (or a picture link) from a comic into a note you pick. Returns where it went. */
export async function saveToNote(dest: Dest, text: string): Promise<string> {
  localStorage.setItem(DEST_KEY, JSON.stringify(dest))
  const r = await saveCapture({ text, target: dest })
  if (!r.ok) throw new Error(r.error ?? 'Couldn’t save it.')
  return r.where ?? 'your note'
}

/** "Add to a note" with the note picker under it. */
export function NoteButton({ label, onSave, disabled, icon, title }: { label: string; onSave: (dest: Dest) => Promise<void>; disabled?: boolean; icon?: ReactNode; title?: string }) {
  const [open, setOpen] = useState(false)
  const destLabel = useDestLabel()
  return (
    <span className="comic-note-btn">
      <button className={label ? 'btn' : 'icon-btn'} disabled={disabled} onClick={() => setOpen((o) => !o)} title={title} data-comic-to-note>
        {icon ?? <NotebookPen size={14} />}
        {label && ` ${label}`}
      </button>
      {open && (
        <div className="comic-dest">
          <DestPicker
            current={lastDest()}
            label={destLabel}
            onPick={(d) => {
              setOpen(false)
              void onSave(d)
            }}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </span>
  )
}

export interface Scan {
  /** The picture of the part you picked (PNG). */
  png: Uint8Array
  page: number
  text: string | null
  error?: string
}

/** What scanning a speech bubble (or any part of a page) read, to copy or put in a note. */
export function ScanCard({ scan, title, onClose, onSavePicture, say }: { scan: Scan; title: string; onClose: () => void; onSavePicture: (dest: Dest) => Promise<void>; say: (msg: string) => void }) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (scan.text !== null) setText(joinBubbleLines(scan.text))
  }, [scan.text])
  const reading = scan.text === null && !scan.error
  const url = useObjectUrl(scan.png)
  return (
    <div className="comic-scan" data-comic-scan onKeyDown={(e) => e.stopPropagation()}>
      <div className="comic-scan-head">
        <img src={url} alt="" />
        <strong>{reading ? 'Reading the text…' : scan.error ? 'Couldn’t read it' : 'Text from page ' + (scan.page + 1)}</strong>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          <X size={14} />
        </button>
      </div>
      {reading ? (
        <div className="comic-scan-wait">
          <Loader2 size={16} className="spin" /> A few seconds…
        </div>
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={scan.error ?? 'No text found. Try a box round just the words.'}
          rows={4}
          data-comic-scan-text
        />
      )}
      <div className="comic-scan-actions">
        <button className="btn" disabled={!text.trim()} onClick={() => setText(sentenceCase(text))} title="Comic lettering is in capitals: make it ordinary sentences">
          <Type size={14} /> Aa
        </button>
        <button
          className="btn"
          disabled={!text.trim()}
          onClick={() => {
            void navigator.clipboard.writeText(text.trim())
            say('Copied')
          }}
        >
          <ClipboardCopy size={14} /> Copy
        </button>
        <NoteButton
          label="Add to a note"
          disabled={!text.trim()}
          onSave={async (d) => {
            try {
              say(`Saved in ${await saveToNote(d, `“${text.trim().replace(/\s*\n\s*/g, ' ')}” (${title}, page ${scan.page + 1})`)}`)
              onClose()
            } catch (err) {
              say(errorMessage(err))
            }
          }}
        />
        <NoteButton label="Save as a picture" onSave={onSavePicture} />
      </div>
    </div>
  )
}

/** A data: address for a picture (the window's security rules don't allow blob: ones). */
function useObjectUrl(bytes: Uint8Array): string {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    setUrl(`data:image/png;base64,${btoa(bin)}`)
  }, [bytes])
  return url
}

/** Issues and chapters: jump to one, or mark where they start yourself. */
export function ChapterMenu({ chapters, own, page, onJump, onChange, onClose }: { chapters: ComicChapter[]; own: boolean; page: number; onJump: (page: number) => void; onChange: (c: ComicChapter[] | null) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const here = chapterAt(chapters, page)
  return (
    <div className="comic-pop comic-chapters" data-comic-chapters onKeyDown={(e) => (e.key === 'Escape' ? onClose() : e.stopPropagation())}>
      <div className="comic-pop-list">
        {chapters.length === 0 && <p className="comic-pop-note">No issues or chapters were found in this comic’s file names. Mark where they start below, and they’ll be here to jump to.</p>}
        {chapters.map((c, i) => (
          <div key={`${c.page}-${i}`} className={`comic-chapter ${i === here ? 'current' : ''}`}>
            <button onClick={() => onJump(c.page)} data-comic-chapter={c.page}>
              <span>{c.title}</span>
              <em>p. {c.page + 1}</em>
            </button>
            {own && (
              <button className="icon-btn" title="Remove this mark" onClick={() => onChange(chapters.filter((x) => x !== c))}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      <form
        className="comic-mark"
        onSubmit={(e) => {
          e.preventDefault()
          onChange(markChapter(chapters, page, name || `Issue ${chapters.length + 1}`))
          setName('')
        }}
      >
        <BookMarked size={14} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Mark page ${page + 1} as the start of…`} data-comic-mark-name />
        <button className="btn" type="submit">
          Mark
        </button>
      </form>
      {own && (
        <button className="comic-pop-link" onClick={() => onChange(null)}>
          Go back to the ones found in the file names
        </button>
      )}
    </div>
  )
}

/** Zen mode's music: one of your Spotify playlists, remembered for this comic if you like. */
export function MusicChooser({ current, onPick, onClose }: { current: ComicPlaylist | null; onPick: (p: ComicPlaylist | null, remember: boolean) => void; onClose: () => void }) {
  const [lists, setLists] = useState<MusicItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [remember, setRemember] = useState(true)
  useEffect(() => {
    window.api.musicPlaylists().then(setLists, (err) => setError(errorMessage(err)))
  }, [])
  return (
    <div className="comic-music" data-comic-music onKeyDown={(e) => (e.key === 'Escape' ? onClose() : e.stopPropagation())}>
      <div className="comic-music-head">
        <Music2 size={16} />
        <strong>Music while you read?</strong>
        <button className="icon-btn" onClick={onClose} title="Close">
          <X size={14} />
        </button>
      </div>
      {error ? (
        <p className="comic-pop-note">{/Settings/.test(error) ? error : `Couldn’t get your Spotify playlists: ${error}`}</p>
      ) : !lists ? (
        <p className="comic-pop-note">
          <Loader2 size={14} className="spin" /> Getting your playlists…
        </p>
      ) : (
        <div className="comic-music-list">
          {lists.length === 0 && <p className="comic-pop-note">You don’t have any Spotify playlists yet.</p>}
          {lists.map((p) => (
            <button key={p.uri} className={current?.uri === p.uri ? 'current' : ''} onClick={() => onPick({ uri: p.uri, name: p.name }, remember)} data-comic-playlist={p.uri}>
              {p.art ? <img src={p.art} alt="" /> : <span className="comic-music-art"><Music2 size={14} /></span>}
              <span>
                <strong>{p.name}</strong>
                <em>{p.detail}</em>
              </span>
              {current?.uri === p.uri && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
      <div className="comic-music-foot">
        <label>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Play it every time I read this comic
        </label>
        <button className="btn" onClick={() => onPick(null, remember)}>
          No music
        </button>
      </div>
    </div>
  )
}
