import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Camera, Film, ImagePlus, Lightbulb, Star, Trash2, X } from 'lucide-react'
import { chosenThumbnailCard, chosenTitleText, formatTime, frameFileName, thumbnailProblems, THUMB_HEIGHT, THUMB_WIDTH, type ThumbnailCard, type VideoDraft } from '../../lib/publishing'
import { addThumbnails, chooseThumbnail, deleteThumbnail, moveThumbnail, setThumbnailText } from '../../store/publishing'
import { usePrefs } from '../../store/prefs'
import { useVault } from '../../store/vault'
import { notify } from '../../store/notify'
import { fileKind, openAttachment, vaultUrl } from '../../lib/fileKinds'
import { getDrag, setDrag } from '../../lib/dnd'
import { videoUrl } from '@shared/videoPlayer'

/** "340 KB", "1.4 MB". */
const sizeText = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

const attachmentFolder = (): string => usePrefs.getState().prefs.attachmentFolder

const pictureCards = (files: string[]): Omit<ThumbnailCard, 'id' | 'created'>[] => files.map((file) => ({ kind: 'picture', text: '', file }))

/** Copies pictures from outside the notes folder (dropped or pasted) into the attachments folder. */
async function saveOutside(list: File[]): Promise<string[]> {
  const saved: string[] = []
  for (const f of list) {
    if (!f.type.startsWith('image/')) continue
    try {
      saved.push(await window.api.saveAttachment(attachmentFolder(), f.name || 'Thumbnail idea.png', new Uint8Array(await f.arrayBuffer())))
    } catch (err) {
      notify(err)
    }
  }
  if (saved.length) void useVault.getState().refresh()
  return saved
}

/** A picture's size in pixels and in bytes, once it's loaded. */
function usePictureFacts(file: string | undefined): { width: number; height: number; bytes: number } | null {
  const [facts, setFacts] = useState<{ file: string; width: number; height: number; bytes: number } | null>(null)
  useEffect(() => {
    if (!file) return
    let alive = true
    const url = vaultUrl(file)
    const img = new Image()
    img.onload = () => {
      fetch(url)
        .then((r) => r.blob())
        .then((b) => alive && setFacts({ file, width: img.naturalWidth, height: img.naturalHeight, bytes: b.size }))
        .catch(() => alive && setFacts({ file, width: img.naturalWidth, height: img.naturalHeight, bytes: 0 }))
    }
    img.src = url
    return () => {
      alive = false
    }
  }, [file])
  return facts && facts.file === file ? facts : null
}

// ---------- grabbing a frame from a video ----------

function FrameGrabber({ videoId, onClose }: { videoId: string; onClose: () => void }) {
  const [path, setPath] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLVideoElement>(null)

  const pick = async (): Promise<void> => {
    const picked = await window.api.pickVideoFile('video').catch(notify)
    if (picked) {
      setFailed(false)
      setPath(picked)
    }
  }
  useEffect(() => {
    void pick()
    // Asks for a video once, when the grabber opens.
  }, [])

  const step = (by: number): void => {
    const v = ref.current
    if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + by))
  }

  const grab = async (): Promise<void> => {
    const v = ref.current
    if (!v || !path || !v.videoWidth) return
    setBusy(true)
    try {
      v.pause()
      const canvas = document.createElement('canvas')
      canvas.width = v.videoWidth
      canvas.height = v.videoHeight
      canvas.getContext('2d')!.drawImage(v, 0, 0)
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'))
      if (!blob) throw new Error('Couldn’t copy that frame.')
      const saved = await window.api.saveAttachment(attachmentFolder(), frameFileName(path, v.currentTime), new Uint8Array(await blob.arrayBuffer()))
      void useVault.getState().refresh()
      addThumbnails(videoId, [{ kind: 'picture', text: `Frame at ${formatTime(v.currentTime)}`, file: saved }])
      notify('Frame added to the board.', 'info')
    } catch (err) {
      notify(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pub-grabber" data-pub-grabber>
      <div className="pub-grabber-head">
        <span>{path ? path.split(/[\\/]/).pop() : 'Pick a video (a recording, a clip, an episode…)'}</span>
        <button className="link-button" onClick={() => void pick()}>
          {path ? 'Another video' : 'Pick a video'}
        </button>
        <button className="icon-btn" onClick={onClose} title="Close">
          <X size={14} />
        </button>
      </div>
      {path &&
        (failed ? (
          <p className="pub-hint pub-warn">Orbit can’t show this video here. Try an MP4 or WebM, or play it in the video player and take a screenshot.</p>
        ) : (
          <>
            <video ref={ref} className="pub-grabber-video" src={videoUrl(path)} crossOrigin="anonymous" controls preload="auto" onError={() => setFailed(true)} />
            <div className="pub-grabber-actions">
              <button className="btn" onClick={() => step(-1 / 30)} title="Back a frame">
                ‹ Frame
              </button>
              <button className="btn" onClick={() => step(1 / 30)} title="Forward a frame">
                Frame ›
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void grab()} data-pub-grab>
                <Camera size={14} /> Grab this frame
              </button>
            </div>
          </>
        ))}
    </div>
  )
}

// ---------- the cards ----------

function Card({ d, card, dragging, setDragging }: { d: VideoDraft; card: ThumbnailCard; dragging: string | null; setDragging: (id: string | null) => void }) {
  const chosen = d.chosenThumbnail === card.id
  const facts = usePictureFacts(card.file)
  const problems = card.file ? thumbnailProblems(card.file, facts ?? undefined, facts?.bytes || undefined) : []
  const [broken, setBroken] = useState(false)
  return (
    <div
      className={`pub-card pub-card-${card.kind} ${chosen ? 'chosen' : ''} ${dragging === card.id ? 'dragging' : ''}`}
      draggable
      onDragStart={(e) => {
        if ((e.target as HTMLElement).closest('textarea, input')) return e.preventDefault()
        setDragging(card.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={() => setDragging(null)}
      onDragOver={(e) => {
        if (dragging && dragging !== card.id) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      onDrop={(e) => {
        if (!dragging) return
        e.preventDefault()
        e.stopPropagation()
        moveThumbnail(d.id, dragging, card.id)
        setDragging(null)
      }}
      data-pub-card
    >
      {card.kind === 'picture' && card.file ? (
        <button className="pub-card-pic" onClick={() => openAttachment(card.file!)} title="Open the picture (crop or edit it there)">
          {broken ? (
            <span className="pub-card-missing">Picture not found</span>
          ) : (
            <img src={vaultUrl(card.file)} alt={card.text || 'Thumbnail idea'} draggable={false} onError={() => setBroken(true)} />
          )}
        </button>
      ) : (
        <div className="pub-card-idea-mark" aria-hidden>
          <Lightbulb size={14} />
        </div>
      )}
      <textarea
        className="pub-card-text"
        value={card.text}
        rows={card.kind === 'idea' ? 4 : 1}
        placeholder={card.kind === 'idea' ? 'The idea: Maggie front and centre, Negan blurred behind, big red “WHY?”' : 'Add a note'}
        aria-label={card.kind === 'idea' ? 'Thumbnail idea' : 'Picture note'}
        onChange={(e) => setThumbnailText(d.id, card.id, e.target.value)}
      />
      <div className="pub-card-foot">
        {card.kind === 'picture' && (
          <button
            className={`icon-btn pub-star ${chosen ? 'on' : ''}`}
            onClick={() => chooseThumbnail(d.id, chosen ? null : card.id)}
            title={chosen ? 'The thumbnail you’re going with' : 'Go with this one'}
            aria-pressed={chosen}
          >
            <Star size={14} />
          </button>
        )}
        <span className="pub-card-facts">
          {facts && `${facts.width}×${facts.height}`}
          {problems.length > 0 && (
            <span className={`pub-${problems.some((p) => p.level === 'error') ? 'error' : 'warn'}`} title={problems.map((p) => p.message).join('\n')}>
              {' '}
              ⚠
            </span>
          )}
        </span>
        <button className="icon-btn" onClick={() => deleteThumbnail(d.id, card.id)} title="Remove from the board (the picture stays in your attachments)">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ---------- how the pick looks on YouTube ----------

function ChosenPreview({ d }: { d: VideoDraft }) {
  const card = chosenThumbnailCard(d)
  const facts = usePictureFacts(card?.file)
  if (!card?.file) return null
  const problems = thumbnailProblems(card.file, facts ?? undefined, facts?.bytes || undefined)
  const title = chosenTitleText(d) || 'No title yet'
  const src = vaultUrl(card.file)
  return (
    <div className="pub-yt" data-pub-thumb-preview>
      <div className="pub-preview-label">How your pick looks on YouTube</div>
      <div className="pub-yt-row">
        <div className="pub-yt-home">
          <div className="pub-yt-thumb">
            <img src={src} alt="" />
            <span className="pub-yt-time">12:34</span>
          </div>
          <div className="pub-yt-title">{title}</div>
          <div className="pub-yt-channel">Your channel · 1K views · 1 hour ago</div>
        </div>
        <div className="pub-yt-small">
          <div className="pub-yt-thumb">
            <img src={src} alt="" />
          </div>
          <div className="pub-yt-title">{title}</div>
          <div className="pub-yt-channel">Up next, at its smallest</div>
        </div>
      </div>
      <div className="pub-yt-checks">
        {facts && !problems.length && (
          <span className="pub-hint pub-ok">
            ✓ {facts.width}×{facts.height}
            {facts.bytes ? `, ${sizeText(facts.bytes)}` : ''}: ready for YouTube
          </span>
        )}
        {problems.map((p) => (
          <span key={p.message} className={`pub-hint pub-${p.level}`}>
            {p.message}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Ideas, frames and pictures for a video's thumbnail, with a star on the one you're going with. */
export default function ThumbnailBoard({ d }: { d: VideoDraft }) {
  const [grabbing, setGrabbing] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)

  const addPictures = async (): Promise<void> => {
    try {
      const files = await window.api.pickAttachment(attachmentFolder(), true)
      if (files.length) {
        void useVault.getState().refresh()
        addThumbnails(d.id, pictureCards(files))
      }
    } catch (err) {
      notify(err)
    }
  }

  const onDragOver = (e: DragEvent<HTMLElement>): void => {
    if (dragging) return
    const drag = getDrag()
    const fromTree = drag?.kind === 'file' && fileKind(drag.path) === 'image'
    const fromComputer = drag?.kind === 'computer' && fileKind(drag.path) === 'image'
    if (!fromTree && !fromComputer && !(!drag && [...e.dataTransfer.types].includes('Files'))) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }

  const onDrop = async (e: DragEvent<HTMLElement>): Promise<void> => {
    setDropping(false)
    if (dragging) return
    const drag = getDrag()
    if (drag?.kind === 'file' && fileKind(drag.path) === 'image') {
      e.preventDefault()
      setDrag(null)
      addThumbnails(d.id, pictureCards([drag.path]))
    } else if (drag?.kind === 'computer' && fileKind(drag.path) === 'image') {
      e.preventDefault()
      setDrag(null)
      try {
        addThumbnails(d.id, pictureCards([await window.api.attachFromComputer(attachmentFolder(), drag.path)]))
        void useVault.getState().refresh()
      } catch (err) {
        notify(err)
      }
    } else if (!drag && e.dataTransfer.files.length) {
      e.preventDefault()
      const saved = await saveOutside([...e.dataTransfer.files])
      if (saved.length) addThumbnails(d.id, pictureCards(saved))
      else notify('Only pictures go on the thumbnail board.', 'info')
    }
  }

  const onPaste = async (e: ClipboardEvent<HTMLElement>): Promise<void> => {
    if ((e.target as HTMLElement).closest('textarea, input')) return
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    const saved = await saveOutside(files)
    if (saved.length) addThumbnails(d.id, pictureCards(saved))
  }

  return (
    <section
      className={`pub-section pub-board ${dropping ? 'dropping' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => void onDrop(e)}
      onPaste={(e) => void onPaste(e)}
      tabIndex={-1}
      data-pub-board
    >
      <header className="pub-section-head">
        <h3>Thumbnail board</h3>
        <button className="link-button" onClick={() => addThumbnails(d.id, [{ kind: 'idea', text: '' }])} data-pub-add-idea>
          <Lightbulb size={13} /> Idea
        </button>
        <button className="link-button" onClick={() => void addPictures()} data-pub-add-picture>
          <ImagePlus size={13} /> Picture
        </button>
        <button className="link-button" onClick={() => setGrabbing(true)} data-pub-grab-frame>
          <Film size={13} /> Frame from a video
        </button>
      </header>
      <p className="pub-intro">
        Write ideas, drop or paste pictures here, or grab a frame from a video. Star the one you’re going with ({THUMB_WIDTH}×{THUMB_HEIGHT} is best). Drag cards to reorder them.
      </p>
      {grabbing && <FrameGrabber videoId={d.id} onClose={() => setGrabbing(false)} />}
      {d.thumbnails.length > 0 ? (
        <div className="pub-cards">
          {d.thumbnails.map((card) => (
            <Card key={card.id} d={d} card={card} dragging={dragging} setDragging={setDragging} />
          ))}
        </div>
      ) : (
        !grabbing && <div className="pub-board-empty">Nothing here yet. Drop a picture, paste one with Ctrl+V, or add an idea.</div>
      )}
      <ChosenPreview d={d} />
    </section>
  )
}
