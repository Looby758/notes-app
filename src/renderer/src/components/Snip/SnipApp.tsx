import './snip.css'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ArrowLeft, Bug, Cloud, Copy, Cpu, Download, FilePlus, Globe, Languages, Loader2, RotateCcw, Settings, Sparkles, X } from 'lucide-react'
import type { SnipReading, SnipTranslation } from '@shared/types'
import { DEFAULT_TARGET, isTarget, megabytes, OCR_LANGS, ocrLangByCode, sameLanguage, TRANSLATE_TARGETS, translationNote } from '@shared/translate'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const norm = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y)
})

// Remembered between snips (this window's own storage; it's fine if it's empty).
const remember = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private storage off: just not remembered
  }
}
const recall = (key: string): string => {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
const LANG_KEY = 'orbit.snip.readAs'
const TARGET_KEY = 'orbit.snip.translateTo'

type Translation = { state: 'working' } | ({ state: 'done' } & SnipTranslation)

/**
 * The screen snip window (#snip): a still picture of your screen, full screen. Drag a box round
 * some text; Orbit reads it and offers to copy it, save it, search, translate or ask the AI.
 *
 * Translate happens right here, on the offline AI, so the text never leaves the computer. Text
 * in another alphabet needs that language's reader: the snip spots the alphabet by itself (or you
 * pick it under "Text is in"), and the reader is a small download made only
 * when you press its button. Google Translate is a separate button, shown only when the offline
 * AI can't do it, and says that it sends the text online.
 */
export default function SnipApp() {
  const [image, setImage] = useState<{ url: string; scale: number } | null>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [done, setDone] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const img = useRef<HTMLImageElement>(null)
  // 'auto' (spot the alphabet), '' (English and other Latin letters) or a reader's code.
  const [lang, setLang] = useState(() => {
    const saved = recall(LANG_KEY)
    return saved === '' || saved === 'latin' ? 'auto' : saved === 'eng' ? '' : ocrLangByCode(saved) ? saved : 'auto'
  })
  const [found, setFound] = useState<Omit<SnipReading, 'text'> | null>(null)
  const [haveLangs, setHaveLangs] = useState<string[]>([])
  const [gettingLang, setGettingLang] = useState(false)
  const [langError, setLangError] = useState<string | null>(null)
  const [target, setTarget] = useState(() => (isTarget(recall(TARGET_KEY)) ? recall(TARGET_KEY) : DEFAULT_TARGET))
  const [translation, setTranslation] = useState<Translation | null>(null)
  const langReady = lang === 'auto' || !lang || haveLangs.includes(lang)

  useEffect(() => {
    void window.api.snipOcrLangs().then(setHaveLangs)
  }, [])

  useEffect(() => {
    window.api.snipImage().then((shot) => {
      if (!shot) {
        void window.api.snipClose()
        return
      }
      // A data: address (the page's security rules don't allow blob: pictures).
      const reader = new FileReader()
      reader.onload = () => setImage({ url: String(reader.result), scale: shot.scale })
      reader.readAsDataURL(new Blob([shot.png as BlobPart], { type: 'image/png' }))
    })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void window.api.snipClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const read = async (b: Box, using = langReady ? lang : ''): Promise<void> => {
    const el = img.current
    if (!el || b.w < 6 || b.h < 6) {
      setBox(null)
      setDone(false)
      return
    }
    setReading(true)
    setError(null)
    setTranslation(null)
    setFound(null)
    // The picture is at the screen's full resolution; the window is in screen points.
    const sx = el.naturalWidth / el.clientWidth
    const sy = el.naturalHeight / el.clientHeight
    // Small text reads better a bit bigger.
    const up = b.h * sy < 60 ? 2 : 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(b.w * sx * up)
    canvas.height = Math.round(b.h * sy * up)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(el, b.x * sx, b.y * sy, b.w * sx, b.h * sy, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    try {
      const got: SnipReading = blob ? await window.api.snipRead(new Uint8Array(await blob.arrayBuffer()), using || undefined) : { text: '' }
      const { text: words, ...about } = got
      setFound(about)
      setText(words)
      if (about.need?.length) setError(null)
      else if (!words) setError('No text found there. Try a bigger box, or one round just the words.')
    } catch {
      setError('Couldn’t read that. Try again.')
    } finally {
      setReading(false)
    }
  }

  const point = (e: MouseEvent): { x: number; y: number } => ({ x: e.clientX, y: e.clientY })

  const onDown = (e: MouseEvent): void => {
    if (e.button !== 0) return
    if ((e.target as Element).closest('.snip-panel')) return
    setStart(point(e))
    setBox({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
    setDone(false)
    setText(null)
    setError(null)
    setTranslation(null)
  }
  const onMove = (e: MouseEvent): void => {
    if (start) setBox(norm(start, point(e)))
  }
  const onUp = (e: MouseEvent): void => {
    if (!start) return
    const b = norm(start, point(e))
    setStart(null)
    setBox(b)
    setDone(true)
    void read(b)
  }

  /** "Report bug": the boxed part of the screen, as it is (not made bigger), goes to App Studio. */
  const reportBug = async (): Promise<void> => {
    const el = img.current
    if (!el || !box) return
    const sx = el.naturalWidth / el.clientWidth
    const sy = el.naturalHeight / el.clientHeight
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(box.w * sx))
    canvas.height = Math.max(1, Math.round(box.h * sy))
    canvas.getContext('2d')!.drawImage(el, box.x * sx, box.y * sy, box.w * sx, box.h * sy, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (blob) await window.api.snipReportBug(new Uint8Array(await blob.arrayBuffer()))
  }

  const send = (action: 'copy' | 'note' | 'web' | 'ask'): void => {
    if (text) void window.api.snipSend(action, text)
  }

  /** Translate on the offline AI, into `to`. */
  const translate = async (to = target): Promise<void> => {
    const t = text?.trim()
    if (!t) return
    setTranslation({ state: 'working' })
    const out = await window.api.snipTranslate(t, to).catch((): SnipTranslation => ({ problem: 'failed', error: 'The offline AI couldn’t translate that. Try again.' }))
    setTranslation({ state: 'done', ...out })
  }
  const pickTarget = (to: string): void => {
    setTarget(to)
    remember(TARGET_KEY, to)
    if (translation?.state === 'done' && !translation.problem) void translate(to)
  }
  /** "Text is in": reads the box again with that language's reader (once it's downloaded). */
  const pickLang = (code: string): void => {
    setLang(code)
    remember(LANG_KEY, code || 'eng')
    setLangError(null)
    if (box && (code === 'auto' || !code || haveLangs.includes(code))) void read(box, code)
  }
  /** Downloads a reader, then reads the box again (still spotting the alphabet, if that's the setting). */
  const getLang = async (code: string): Promise<void> => {
    setGettingLang(true)
    setLangError(null)
    const r = await window.api.snipGetOcrLang(code).catch(() => ({ error: 'Couldn’t download it. Try again.' }))
    setGettingLang(false)
    if ('error' in r) {
      setLangError(r.error)
      return
    }
    setHaveLangs((h) => [...h, code])
    if (box) void read(box, lang === 'auto' ? 'auto' : code)
  }

  // Keep the panel on screen: under the box, or above it near the bottom.
  const panelHeight = translation ? 330 : 280
  const panelStyle = box
    ? {
        left: Math.min(Math.max(8, box.x), window.innerWidth - 428),
        top: box.y + box.h + panelHeight > window.innerHeight ? Math.max(8, box.y - panelHeight) : box.y + box.h + 10
      }
    : {}

  const missingLang = !langReady ? ocrLangByCode(lang) : undefined
  const getButton = (code: string, primary: boolean) => {
    const l = ocrLangByCode(code)!
    return (
      <button key={code} className={`btn ${primary ? 'btn-primary' : ''}`} disabled={gettingLang} onClick={() => void getLang(code)} data-snip-lang-download={code}>
        {gettingLang ? <Loader2 size={13} className="spin" /> : <Download size={13} />} {l.name} ({megabytes(l.bytes)})
      </button>
    )
  }
  // "Detect automatically" spotted an alphabet whose reader isn't downloaded yet.
  const needed = lang === 'auto' && found?.need?.length ? found.need : null
  const readAs = (
    <div className="snip-lang">
      <label>
        Text is in
        <select value={lang} onChange={(e) => pickLang(e.target.value)} title="Which reader to use. Pick the language for text that isn’t in plain Latin letters" data-snip-lang>
          <option value="auto">{lang === 'auto' && found?.detected && !needed ? `Detect automatically (${found.detected})` : 'Detect automatically'}</option>
          <option value="">English or Latin letters</option>
          {OCR_LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
              {haveLangs.includes(l.code) ? '' : ` (${megabytes(l.bytes)} download)`}
            </option>
          ))}
        </select>
      </label>
      {missingLang && (
        <div className="snip-lang-get" data-snip-lang-get>
          <span>Reading {missingLang.name} needs its reader, a one-off {megabytes(missingLang.bytes)} download. It’s only the reader: your snip stays on this computer.</span>
          {getButton(missingLang.code, true)}
          {langError && <p className="snip-error">{langError}</p>}
        </div>
      )}
      {needed && (
        <div className="snip-lang-get" data-snip-lang-need>
          <span>
            This looks like {found?.detected}. To read it, Orbit needs {needed.length > 1 ? 'one of these readers' : 'its reader'}, a one-off download. It’s only the reader: your snip stays on this
            computer, and next time it’s used by itself.
          </span>
          <div className="snip-actions">{needed.map((c, i) => getButton(c, i === 0))}</div>
          {langError && <p className="snip-error">{langError}</p>}
        </div>
      )}
    </div>
  )

  const targetPicker = (
    <select className="snip-target" value={target} onChange={(e) => pickTarget(e.target.value)} title="Translate into" data-snip-target>
      {TRANSLATE_TARGETS.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  )

  const online = (primary = false) => (
    <button
      className={`btn ${primary ? 'btn-primary' : ''}`}
      onClick={() => text && void window.api.snipSend('translate-online', text, target)}
      title="Opens Google Translate with this text: it sends the text online"
      data-snip-translate-online
    >
      <Cloud size={13} /> Translate online
    </button>
  )

  const translationView = (tr: Translation) => {
    const back = (
      <button className="btn" onClick={() => setTranslation(null)} title="Back to the text" data-snip-back>
        <ArrowLeft size={13} /> Back
      </button>
    )
    if (tr.state === 'working') {
      return (
        <p className="snip-reading" data-snip-translating>
          <Loader2 size={14} className="spin" /> Translating into {target} on this computer… (the first one can take a moment while the offline AI loads)
        </p>
      )
    }
    if (tr.problem) {
      return (
        <div className="snip-problem" data-snip-problem={tr.problem}>
          <p>
            <Languages size={14} /> {tr.error}
          </p>
          {tr.problem === 'missing' && (
            <p className="snip-muted">The offline AI is a free download that runs on your own graphics card, so what you snip never leaves this computer. You set it up once.</p>
          )}
          <div className="snip-actions">
            {tr.problem === 'missing' && (
              <button className="btn btn-primary" onClick={() => void window.api.snipSend('setup-ai', '')} data-snip-setup-ai>
                <Settings size={13} /> Set up the offline AI
              </button>
            )}
            {tr.problem === 'failed' && (
              <button className="btn btn-primary" onClick={() => void translate()} data-snip-retry>
                <RotateCcw size={13} /> Try again
              </button>
            )}
            {online(tr.problem === 'unsupported')}
            {back}
          </div>
          <p className="snip-muted snip-online-note">Translate online opens Google Translate with this text, so it leaves this computer.</p>
        </div>
      )
    }
    const same = sameLanguage(tr.from, target)
    return (
      <div className="snip-translation" data-snip-translation>
        <div className="snip-translation-head">
          <span>{tr.from || 'Translated'} →</span>
          {targetPicker}
        </div>
        <textarea value={tr.text} onChange={(e) => setTranslation({ ...tr, text: e.target.value })} rows={Math.min(8, tr.text.split('\n').length + 1)} autoFocus data-snip-translated />
        {same && <p className="snip-muted">This already looks like {target}. Pick another language above to translate it into that.</p>}
        <div className="snip-actions">
          <button
            className="btn btn-primary"
            onClick={() => void window.api.snipSend('copy', tr.text)}
            data-snip-copy-translation
          >
            <Copy size={13} /> Copy
          </button>
          <button
            className="btn"
            onClick={() => text && void window.api.snipSend('note', translationNote(text, tr.text, tr.from, target))}
            title="Add the text and its translation to today’s note"
          >
            <FilePlus size={13} /> Save
          </button>
          {back}
        </div>
        <p className="snip-muted snip-offline-note" data-snip-offline>
          <Cpu size={12} /> Translated by the offline AI. Nothing left this computer.
        </p>
      </div>
    )
  }

  return (
    <div className="snip" onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} data-snip>
      {image && <img ref={img} className="snip-shot" src={image.url} alt="" draggable={false} />}
      {box ? (
        <div className="snip-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
      ) : (
        <div className="snip-dim" />
      )}
      {!box && image && <div className="snip-hint">Drag a box round the text you want · Esc to cancel</div>}
      {done && box && box.w >= 6 && (
        <div className="snip-panel" style={panelStyle} onMouseDown={(e) => e.stopPropagation()} data-snip-panel>
          {reading ? (
            <p className="snip-reading">
              <Loader2 size={14} className="spin" /> Reading the text…
            </p>
          ) : translation ? (
            translationView(translation)
          ) : needed ? (
            readAs
          ) : error ? (
            <>
              <p className="snip-error">{error}</p>
              {readAs}
            </>
          ) : (
            <>
              <textarea value={text ?? ''} onChange={(e) => setText(e.target.value)} rows={Math.min(8, (text ?? '').split('\n').length + 1)} autoFocus data-snip-text />
              <div className="snip-actions">
                <button className="btn btn-primary" onClick={() => send('copy')} data-snip-copy>
                  <Copy size={13} /> Copy
                </button>
                <button className="btn" onClick={() => send('note')} title="Add to today’s note">
                  <FilePlus size={13} /> Save
                </button>
                <button className="btn" onClick={() => send('web')} title="Search the web">
                  <Globe size={13} /> Search
                </button>
                <button className="btn" onClick={() => void translate()} title={`Translate into ${target} with the offline AI (stays on this computer)`} data-snip-translate>
                  <Languages size={13} /> Translate
                </button>
                <button className="btn" onClick={() => send('ask')} title="Ask the AI what this is">
                  <Sparkles size={13} /> Ask AI
                </button>
              </div>
              {readAs}
            </>
          )}
          <button className="btn snip-bug" onClick={() => void reportBug()} title="Send this part of the screen to App Studio as a bug in one of your apps" data-snip-bug>
            <Bug size={13} /> Report bug
          </button>
          <button className="icon-btn snip-close" onClick={() => void window.api.snipClose()} title="Close (Esc)">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
