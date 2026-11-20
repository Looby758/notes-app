import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import '@fontsource/opendyslexic/400.css'
import '@fontsource/opendyslexic/700.css'
import { ChevronsDown, ChevronsUp, Expand, FlipHorizontal, ListOrdered, Minus, Pause, Play, Plus, RefreshCw, RotateCcw, Settings2, X } from 'lucide-react'
import type { FileNode } from '@shared/types'
import { showKeys } from '@shared/platform'
import { isScriptNote, MARKER_INFO, resolveImage } from '../../lib/script'
import { crossed, holdFor, prompterBlocks, prompterWords, scrollSpeed, sectionJump, type PlacedMarker, type PrompterBlock } from '../../lib/teleprompter'
import { toVaultUrl } from '../../lib/paths'
import { isTyping } from '../../lib/undo'
import { listFonts } from '../../lib/fonts'
import { sectionsOf } from '../../lib/takes'
import { quickRetake, recordSection, scriptEndReached, sectionMarkerReached, setBySection, setTakeSections, stepSection, useTakes } from '../../store/takes'
import { SectionTakes } from './SectionTakes'
import { vaultImages } from '../Editor/scriptTools'
import { useVault } from '../../store/vault'
import { usePrefs } from '../../store/prefs'
import { ensureVideos, useVideos } from '../../store/videos'
import {
  BUILT_IN_FONTS,
  chooseScript,
  LOOK_LIMITS,
  markerReached,
  nudgeSpeed,
  openPrompter,
  pausePrompter,
  restartPrompter,
  setLook,
  startPrompter,
  togglePrompter,
  usePrompter
} from '../../store/teleprompter'

/**
 * The teleprompter: your script scrolls past a reading line at your speaking pace while you
 * record. Markers show as small coloured icons, a picture cue shows its picture as it reaches the
 * line, [PAUSE] holds the scroll for a moment, and notes to self are left out.
 */

/** Video projects with a script, then any other script notes ("Script….md" or `type: script`). */
function useScriptChoices(): { path: string; label: string }[] {
  const projects = useVideos((s) => s.projects)
  const tree = useVault((s) => s.tree)
  useEffect(() => void ensureVideos(), [])
  return useMemo(() => {
    const out: { path: string; label: string }[] = []
    const seen = new Set<string>()
    for (const p of projects) {
      if (!p.script || seen.has(p.script)) continue
      seen.add(p.script)
      out.push({ path: p.script, label: `${p.title} (video)` })
    }
    const walk = (nodes: FileNode[]): void => {
      for (const n of nodes) {
        if (n.children) walk(n.children)
        else if (n.type === 'file' && !seen.has(n.path) && isScriptNote(n.path)) {
          seen.add(n.path)
          out.push({ path: n.path, label: n.path.replace(/\.md$/i, '') })
        }
      }
    }
    walk(tree)
    return out
  }, [projects, tree])
}

export function Teleprompter({ compactTop }: { compactTop?: React.ReactNode }) {
  const s = usePrompter()
  const wpm = usePrefs((p) => p.prefs.scriptWpm)
  const choices = useScriptChoices()
  const [text, setText] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [cue, setCue] = useState<{ src: string; name: string; key: number } | null>(null)
  const [boxH, setBoxH] = useState(600)
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)

  // Pick a script to start with: the video you have open on the Videos page, or the first one.
  const selectedVideo = useVideos((v) => v.projects.find((p) => p.id === v.selected)?.script ?? null)
  useEffect(() => {
    if (!s.script && choices.length) chooseScriptQuietly(selectedVideo ?? choices[0].path)
  }, [s.script, choices, selectedVideo])

  useEffect(() => {
    if (!s.script) return setText(null)
    let alive = true
    setProblem(null)
    window.api
      .readNote(s.script)
      .then((t) => alive && setText(t))
      .catch(() => {
        if (!alive) return
        setText(null)
        setProblem('That script isn’t in your notes any more. Pick another one.')
      })
    return () => {
      alive = false
    }
  }, [s.script, reload])

  const blocks = useMemo(() => (text === null ? [] : prompterBlocks(text)), [text])
  const words = useMemo(() => prompterWords(blocks), [blocks])
  const bySection = useTakes((t) => t.on)
  const currentFrom = useTakes((t) => (t.on ? (t.sections.find((x) => x.key === t.current)?.from ?? null) : null))
  // Record by section works from the script's sections.
  useEffect(() => setTakeSections(text === null ? null : s.script, text === null ? [] : sectionsOf(text, wpm)), [text, s.script, wpm])

  // ---------- scrolling ----------

  const pos = useRef(0)
  const holdUntil = useRef(0)
  const markers = useRef<PlacedMarker[]>([])
  const sections = useRef<number[]>([])
  const textHeight = useRef(0)
  const live = useRef({ ...s, wpm, words })
  live.current = { ...s, wpm, words }

  /** Measures where each marker and section sits on the page (after a resize or a new size). */
  const measure = (): void => {
    const el = page.current
    if (!el) return
    // How far down the page something is, less where the reading line sits: so it's on the line
    // exactly when the scroll position equals this.
    const top = el.getBoundingClientRect().top
    const line = (box.current?.clientHeight ?? 0) * live.current.linePos
    const at = (n: Element): number => n.getBoundingClientRect().top - top - line
    markers.current = [...el.querySelectorAll<HTMLElement>('[data-cue-from]')].map((n) => ({
      from: Number(n.dataset.cueFrom),
      text: n.dataset.cueText ?? '',
      type: n.dataset.cueType as PlacedMarker['type'],
      value: n.dataset.cueValue ?? '',
      y: at(n) + n.getBoundingClientRect().height / 2
    }))
    sections.current = [...el.querySelectorAll('[data-section]')].map((n) => at(n))
    const blocksEls = el.querySelectorAll('.prompter-block')
    textHeight.current = blocksEls.length ? at(blocksEls[blocksEls.length - 1]) + blocksEls[blocksEls.length - 1].getBoundingClientRect().height - at(blocksEls[0]) : 0
  }

  useLayoutEffect(() => {
    measure()
    const ro = new ResizeObserver(() => {
      if (box.current) setBoxH(box.current.clientHeight)
      measure()
    })
    if (page.current) ro.observe(page.current)
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [blocks, s.fontSize, s.linePos, s.font, boxH])

  // Back to the top for a new script or a restart.
  useEffect(() => {
    pos.current = 0
    holdUntil.current = 0
    if (scroller.current) scroller.current.scrollTop = 0
  }, [s.restartAt, s.script])

  // To a section's start (record by section): its title just under the reading line.
  useEffect(() => {
    if (!s.jump) return
    const go = (): void => {
      measure()
      const m = markers.current.find((x) => x.from === s.jump!.from && x.type === 'SECTION')
      pos.current = m ? Math.max(0, m.y - live.current.fontSize * 1.6) : 0
      holdUntil.current = 0
      if (scroller.current) scroller.current.scrollTop = pos.current
    }
    go()
    // Once more after the script has laid out (a jump can come with a new script).
    const t = setTimeout(go, 120)
    return () => clearTimeout(t)
  }, [s.jump, blocks])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const el = scroller.current
      const st = live.current
      if (el) {
        // You scrolled it yourself (mouse wheel): carry on from there.
        if (Math.abs(el.scrollTop - pos.current) > 2) pos.current = el.scrollTop
        const before = pos.current
        if (st.playing && now >= holdUntil.current) {
          const speed = scrollSpeed(textHeight.current, st.words, st.wpm, st.speed)
          const max = el.scrollHeight - el.clientHeight
          pos.current = Math.min(max, pos.current + speed * dt)
          el.scrollTop = pos.current
          if (pos.current >= max - 0.5) {
            pausePrompter()
            scriptEndReached()
          }
        }
        for (const m of crossed(markers.current, before, pos.current)) {
          markerReached(m.from, m.text)
          if (m.type === 'SECTION') sectionMarkerReached(m.from)
          if (st.holdPauses && holdFor(m) > 0) holdUntil.current = now + holdFor(m) * 1000
          if (m.type === 'IMAGE') {
            const img = resolveImage(m.value, vaultImages(), usePrefs.getState().prefs.attachmentFolder)
            if (img) setCue({ src: toVaultUrl(img), name: m.value, key: now })
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // The picture cue fades after a few seconds.
  useEffect(() => {
    if (!cue) return
    const t = setTimeout(() => setCue(null), 3500)
    return () => clearTimeout(t)
  }, [cue])

  const jump = (dir: 1 | -1): void => {
    const to = sectionJump(sections.current, pos.current, dir)
    if (to === null || !scroller.current) return
    pos.current = Math.max(0, to)
    scroller.current.scrollTop = pos.current
  }

  // Keys while the Studio is showing the teleprompter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || (e.target as HTMLElement).closest?.('select')) return
      const k = e.key
      // A button you just clicked keeps the focus: Space shouldn't press it again as well.
      if (k === ' ' && e.target instanceof HTMLButtonElement) e.target.blur()
      const sections = useTakes.getState().on
      if (k === ' ') togglePrompter()
      else if (k === 'ArrowUp') nudgeSpeed(0.05)
      else if (k === 'ArrowDown') nudgeSpeed(-0.05)
      else if (k === 'PageDown') (sections ? stepSection(1) : jump(1))
      else if (k === 'PageUp') (sections ? stepSection(-1) : jump(-1))
      else if (sections && k === 'Enter' && !(e.target instanceof HTMLButtonElement)) void recordSection()
      else if (sections && (k === 'r' || k === 'R')) quickRetake()
      else if (k === 'Home') restartPrompter()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const images = useMemo(() => (blocks.length ? vaultImages() : []), [blocks])
  const folder = usePrefs((p) => p.prefs.attachmentFolder)
  const minutes = words && wpm ? Math.max(1, Math.round(words / (wpm * s.speed))) : 0

  return (
    <div className="prompter" data-prompter>
      <div className="prompter-bar">
        <select value={s.script ?? ''} onChange={(e) => chooseScript(e.target.value || null)} aria-label="Script" title="Which script to read">
          {!choices.length && <option value="">No scripts yet</option>}
          {s.script && !choices.some((c) => c.path === s.script) && <option value={s.script}>{s.script.replace(/\.md$/i, '')}</option>}
          {choices.map((c) => (
            <option key={c.path} value={c.path}>
              {c.label}
            </option>
          ))}
        </select>
        <button className="icon-btn" title="Load the script again (after editing it)" onClick={() => setReload((n) => n + 1)}>
          <RefreshCw size={14} />
        </button>
        <button className={`btn prompter-by-section ${bySection ? 'on' : ''}`} onClick={() => setBySection(!bySection)} title="Record one section at a time, then join the best takes" aria-pressed={bySection} data-prompter-by-section>
          <ListOrdered size={14} /> By section
        </button>
        <span className="prompter-gap" />
        <button className="icon-btn" title={`Back a section (${showKeys('PageUp')})`} onClick={() => (bySection ? stepSection(-1) : jump(-1))}>
          <ChevronsUp size={15} />
        </button>
        <button className={`btn prompter-play ${s.playing ? 'on' : ''}`} onClick={() => (s.playing || s.countdown !== null ? pausePrompter() : startPrompter(false))} title="Pause or carry on (Space)" data-prompter-play>
          {s.playing ? <Pause size={14} /> : <Play size={14} />} {s.playing ? 'Pause' : s.countdown !== null ? s.countdown : 'Scroll'}
        </button>
        <button className="icon-btn" title={`On a section (${showKeys('PageDown')})`} onClick={() => (bySection ? stepSection(1) : jump(1))}>
          <ChevronsDown size={15} />
        </button>
        <button className="icon-btn" title="Back to the top (Home)" onClick={() => restartPrompter()}>
          <RotateCcw size={14} />
        </button>
        <span className="prompter-gap" />
        <div className="prompter-speed" title="Speed (↑ and ↓)">
          <button className="icon-btn" onClick={() => nudgeSpeed(-0.05)} aria-label="Slower">
            <Minus size={13} />
          </button>
          <span>
            {Math.round(wpm * s.speed)} wpm
          </span>
          <button className="icon-btn" onClick={() => nudgeSpeed(0.05)} aria-label="Faster">
            <Plus size={13} />
          </button>
        </div>
        <div className="prompter-settings-wrap">
          <button className={`icon-btn ${showSettings ? 'on' : ''}`} title="Text size, reading line and more" onClick={() => setShowSettings((v) => !v)} data-prompter-settings>
            <Settings2 size={15} />
          </button>
          {showSettings && <PrompterSettings onClose={() => setShowSettings(false)} />}
        </div>
        <button className="icon-btn" title="Full screen (for a second screen or a teleprompter glass)" onClick={() => void box.current?.closest('.prompter')?.requestFullscreen?.()}>
          <Expand size={14} />
        </button>
        <button className="icon-btn" title="Close the teleprompter" onClick={() => openPrompter(false)}>
          <X size={15} />
        </button>
      </div>
      {compactTop}
      <div className="prompter-body">
      {bySection && <SectionTakes />}
      <div className="prompter-screen" ref={box} style={{ ['--prompter-line' as string]: `${s.linePos * 100}%` }}>
        <div className="prompter-scroll" ref={scroller} onWheel={() => (holdUntil.current = 0)}>
          <div className="prompter-page" ref={page} style={{ fontSize: s.fontSize, fontFamily: prompterFont(s.font), transform: s.mirror ? 'scaleX(-1)' : undefined, paddingTop: Math.max(0, boxH * s.linePos - s.fontSize * 0.7), paddingBottom: boxH }}>
            {problem ? (
              <p className="prompter-empty">{problem}</p>
            ) : !s.script ? (
              <p className="prompter-empty">Pick a script above. Any note called “Script…”, or a video’s script, can go on the teleprompter.</p>
            ) : text === null ? (
              <p className="prompter-empty">Loading the script…</p>
            ) : !blocks.length ? (
              <p className="prompter-empty">This script is empty. Write it first, then come back.</p>
            ) : (
              blocks.map((b) => <Block key={`${b.kind}:${b.from}`} block={b} images={images} folder={folder} current={b.kind === 'section' && b.from === currentFrom} />)
            )}
          </div>
        </div>
        <div className="prompter-line" aria-hidden style={{ top: boxH * s.linePos - s.fontSize * 0.78, height: s.fontSize * 1.56 }} />
        {s.countdown !== null && <div className="prompter-countdown">{s.countdown}</div>}
        {cue && (
          <div className="prompter-cue" key={cue.key} data-prompter-cue>
            <img src={cue.src} alt="" />
            <span>{cue.name}</span>
          </div>
        )}
      </div>
      </div>
      <div className="prompter-foot">
        {words > 0 && (
          <span>
            {words.toLocaleString()} words · about {minutes} min at {Math.round(wpm * s.speed)} words a minute
          </span>
        )}
        <span className="prompter-gap" />
        <span>{bySection ? 'Enter record or stop · R quick retake · PgUp/PgDn pick a section · Space pause' : `Space pause · ↑↓ speed · PgUp/PgDn sections · ${showKeys('Ctrl+Alt+Space')} anywhere in Orbit`}</span>
      </div>
    </div>
  )
}

/** The CSS font for a choice, falling back to Orbit's own font while it loads or if it's gone. */
export const prompterFont = (font: string): string | undefined => (font ? `"${font}", var(--font-ui)` : undefined)

function chooseScriptQuietly(path: string): void {
  usePrompter.setState({ script: path, playing: false, countdown: null, restartAt: Date.now() })
}

function Block({ block, images, folder, current }: { block: PrompterBlock; images: string[]; folder: string; current?: boolean }) {
  if (block.kind === 'section')
    return (
      <div className={`prompter-block prompter-section ${current ? 'current' : ''}`} data-section data-cue-from={block.from} data-cue-text={block.text} data-cue-type="SECTION" data-cue-value={block.title}>
        <span className="prompter-icon prompter-icon-section">§</span> {block.title || 'New section'}
      </div>
    )
  if (block.kind === 'heading') return <div className="prompter-block prompter-heading">{block.text}</div>
  return (
    <p className="prompter-block">
      {block.parts.map((p, i) => {
        if (p.kind === 'text') return <span key={i}>{p.text}</span>
        const info = MARKER_INFO[p.type]
        const img = p.type === 'IMAGE' ? resolveImage(p.value, images, folder) : null
        const data = { 'data-cue-from': p.from, 'data-cue-text': p.text, 'data-cue-type': p.type, 'data-cue-value': p.value }
        if (p.type === 'EMPHASIS')
          return (
            <strong key={i} className="prompter-emphasis" {...data}>
              {p.value}
            </strong>
          )
        return (
          <span key={i} className={`prompter-icon prompter-icon-${p.type.toLowerCase()}`} title={`${info.label}${p.value ? `: ${p.value}` : ''}`} {...data}>
            {img ? <img src={toVaultUrl(img)} alt="" /> : info.icon}
            {p.type === 'PAUSE' && <small>{p.value || 'pause'}</small>}
          </span>
        )
      })}
    </p>
  )
}

function PrompterSettings({ onClose }: { onClose: () => void }) {
  const s = usePrompter()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const [installed, setInstalled] = useState<string[]>([])
  useEffect(() => void listFonts().then(setInstalled), [])
  const others = installed.filter((f) => !(BUILT_IN_FONTS as readonly string[]).includes(f))
  return (
    <div className="prompter-settings" data-prompter-settings-menu>
      <label>
        Font
        <select value={s.font} onChange={(e) => setLook('font', e.target.value)} style={{ fontFamily: prompterFont(s.font) }} data-prompter-font>
          <option value="">Orbit’s font</option>
          <optgroup label="Built in">
            <option value="OpenDyslexic" style={{ fontFamily: prompterFont('OpenDyslexic') }}>
              OpenDyslexic (easier to read with dyslexia)
            </option>
          </optgroup>
          {others.length > 0 && (
            <optgroup label="On this computer">
              {s.font && !BUILT_IN_FONTS.includes(s.font as never) && !others.includes(s.font) && <option value={s.font}>{s.font}</option>}
              {others.map((f) => (
                <option key={f} value={f} style={{ fontFamily: prompterFont(f) }}>
                  {f}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label>
        Text size {s.fontSize}px
        <input type="range" min={LOOK_LIMITS.fontSize[0]} max={LOOK_LIMITS.fontSize[1]} step={2} value={s.fontSize} onChange={(e) => setLook('fontSize', Number(e.target.value))} />
      </label>
      <label>
        Reading line {Math.round(s.linePos * 100)}% down
        <input type="range" min={LOOK_LIMITS.linePos[0]} max={LOOK_LIMITS.linePos[1]} step={0.01} value={s.linePos} onChange={(e) => setLook('linePos', Number(e.target.value))} />
      </label>
      <label>
        Speed ×{s.speed.toFixed(2)}
        <input type="range" min={LOOK_LIMITS.speed[0]} max={LOOK_LIMITS.speed[1]} step={0.05} value={s.speed} onChange={(e) => setLook('speed', Number(e.target.value))} />
      </label>
      <p className="studio-hint">Your pace is set in Settings → Notes (script words a minute); this speeds it up or slows it down.</p>
      <label className="studio-check">
        <input type="checkbox" checked={s.autoStart} onChange={(e) => setLook('autoStart', e.target.checked)} /> Start scrolling when I press Record (after 3, 2, 1)
      </label>
      <label className="studio-check">
        <input type="checkbox" checked={s.holdPauses} onChange={(e) => setLook('holdPauses', e.target.checked)} /> Stop for a moment at each Pause marker
      </label>
      <label className="studio-check">
        <input type="checkbox" checked={s.mirror} onChange={(e) => setLook('mirror', e.target.checked)} /> <FlipHorizontal size={13} /> Mirror (for a teleprompter glass)
      </label>
    </div>
  )
}
