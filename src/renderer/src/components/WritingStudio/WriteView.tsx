import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  Copy,
  Flag,
  Ghost,
  HelpCircle,
  History,
  Loader2,
  MessageSquareQuote,
  Pause,
  Pencil,
  Play,
  Plus,
  Scissors,
  ShieldCheck,
  Trash2,
  Undo2,
  UserPlus,
  Volume2,
  X
} from 'lucide-react'
import {
  activeTake,
  allScenes,
  buildBrain,
  calendarClashes,
  chapterWords,
  checkContinuity,
  countWords,
  dateLabel,
  entityById,
  findMentions,
  findQuote,
  pacing,
  sceneText,
  sceneWords,
  textAt,
  type Chapter,
  type Pacing,
  type Scene,
  type Story,
  type Take
} from '@shared/writing'
import { notify } from '../../store/notify'
import {
  addChapter,
  addScene,
  addTake,
  deleteChapter,
  deleteScene,
  deleteTake,
  moveChapter,
  moveScene,
  openScene,
  renameChapter,
  renameTake,
  setTakeText,
  takeFromVersion,
  updateScene,
  useTake,
  useWriting
} from '../../store/writingStudio'
import { aiWhere, runGhostReader, showAiProblem } from '../../lib/writingAi'
import { canonIssues, secretSlips, storyLines, threadMarks, voiceFlags } from '@shared/writingTools'
import StoryEditor, { type Mark } from './StoryEditor'
import { CommentsPanel, CutsPanel, lovedMarks, ReadAloudBar, StuckPanel, ThreadsPanel, useEditorBridge, toolCounts } from './WriteTools'

/** Writing: the chapters and scenes down the side, the page in the middle, and checks, the ghost reader and the time-lapse on the right. */

const pacingCache = new WeakMap<Take, Pacing>()
function takePacing(take: Take): Pacing {
  let p = pacingCache.get(take)
  if (!p) {
    p = pacing(take.text)
    pacingCache.set(take, p)
  }
  return p
}

/** A chapter's pacing: its scenes' pacing, weighted by how long each is. */
function chapterPacing(chapter: Chapter): Pacing {
  let total = 0
  const sum = { dialogue: 0, action: 0, description: 0 }
  for (const s of chapter.scenes) {
    const t = activeTake(s)
    const len = t.text.length
    if (!len) continue
    const p = takePacing(t)
    sum.dialogue += p.dialogue * len
    sum.action += p.action * len
    sum.description += p.description * len
    total += len
  }
  return total ? { dialogue: sum.dialogue / total, action: sum.action / total, description: sum.description / total } : { dialogue: 0, action: 0, description: 0 }
}

export function PacingStrip({ p, title }: { p: Pacing; title?: string }) {
  const pct = (n: number): string => `${Math.round(n * 100)}%`
  const empty = !p.dialogue && !p.action && !p.description
  return (
    <div
      className={`ws-pacing ${empty ? 'empty' : ''}`}
      title={empty ? 'Nothing written yet' : `${title ? `${title}: ` : ''}${pct(p.dialogue)} dialogue, ${pct(p.action)} action, ${pct(p.description)} description`}
      data-ws-pacing
    >
      <span className="ws-p-dialogue" style={{ width: pct(p.dialogue) }} />
      <span className="ws-p-action" style={{ width: pct(p.action) }} />
      <span className="ws-p-description" style={{ width: pct(p.description) }} />
    </div>
  )
}

type Panel = 'checks' | 'threads' | 'ghost' | 'comments' | 'cuts' | 'stuck' | 'timelapse'

const TOOLS: { id: Panel; title: string; icon: typeof Ghost }[] = [
  { id: 'checks', title: 'Checks: continuity, canon, secrets and voice', icon: ShieldCheck },
  { id: 'threads', title: 'Setups and payoffs', icon: Flag },
  { id: 'ghost', title: 'Ghost reader', icon: Ghost },
  { id: 'comments', title: 'Reader comments', icon: MessageSquareQuote },
  { id: 'cuts', title: 'Cutting room floor', icon: Scissors },
  { id: 'stuck', title: 'Stuck?', icon: HelpCircle },
  { id: 'timelapse', title: 'Time-lapse', icon: History }
]

export default function WriteView() {
  const story = useWriting((s) => s.story)!
  const sceneId = useWriting((s) => s.scene)
  const welcome = useWriting((s) => s.welcome)
  const placed = useMemo(() => allScenes(story).find((p) => p.scene.id === sceneId) ?? allScenes(story)[0], [story, sceneId])
  const [panel, setPanel] = useState<Panel | null>(null)
  const [reading, setReading] = useState(false)
  const [focus, setFocus] = useState<{ from: number; to: number; nonce: number } | null>(null)
  const [compare, setCompare] = useState<string | null>(null)

  useEffect(() => {
    if (placed && placed.scene.id !== sceneId) useWriting.setState({ scene: placed.scene.id })
  }, [placed, sceneId])

  if (!placed) return null
  const counts = toolCounts(story, placed.chapter)
  const jump = (scene: string, from: number, to: number): void => {
    if (scene !== placed.scene.id) openScene(scene)
    // After the scene's editor has started.
    setTimeout(() => setFocus({ from, to, nonce: Date.now() }), 30)
  }

  return (
    <div className={`ws-write ${panel && panel !== 'timelapse' ? 'with-panel' : ''}`} data-ws-write>
      <Outline story={story} current={placed.scene.id} />
      <main className="ws-page">
        {welcome && (
          <div className="ws-welcome" data-ws-welcome>
            <span className="ws-welcome-label">Last time you left off:</span>
            <span className="ws-welcome-text">{welcome}</span>
            <button className="icon-btn" onClick={() => useWriting.setState({ welcome: null })} title="Got it">
              <X size={13} />
            </button>
          </div>
        )}
        <SceneHead story={story} scene={placed.scene} chapter={placed.chapter} compare={compare} setCompare={setCompare} />
        <SceneDetails story={story} scene={placed.scene} />
        {reading && panel !== 'timelapse' && <ReadAloudBar scene={placed.scene} onClose={() => setReading(false)} />}
        {panel === 'timelapse' ? (
          <TimeLapse scene={placed.scene} onClose={() => setPanel(null)} />
        ) : (
          <div className={`ws-editors ${compare ? 'split' : ''}`}>
            <SceneEditor story={story} scene={placed.scene} chapter={placed.chapter} focus={focus} />
            {compare && <CompareTake scene={placed.scene} takeId={compare} onPick={setCompare} onClose={() => setCompare(null)} />}
          </div>
        )}
      </main>
      <aside className="ws-tools">
        <div className="ws-tool-buttons">
          {TOOLS.map((t) => (
            <button key={t.id} className={`ws-tool ${panel === t.id ? 'on' : ''}`} onClick={() => setPanel(panel === t.id ? null : t.id)} title={t.title} data-ws-tool={t.id}>
              <t.icon size={16} />
              {t.id === 'checks' && <CheckCount story={story} scene={placed.scene} />}
              {t.id === 'threads' && counts.open > 0 && <span className="ws-badge soft">{counts.open}</span>}
              {t.id === 'comments' && counts.comments > 0 && <span className="ws-badge soft">{counts.comments}</span>}
            </button>
          ))}
          <span className="ws-tool-sep" />
          <button className={`ws-tool ${reading ? 'on' : ''}`} onClick={() => setReading(!reading)} title="Read it to me" data-ws-tool="read">
            <Volume2 size={16} />
          </button>
        </div>
        <div className="ws-panel-host" key={panel ?? 'none'}>
          {panel === 'checks' && <ChecksPanel story={story} scene={placed.scene} onJump={jump} />}
          {panel === 'ghost' && <GhostPanel story={story} chapter={placed.chapter} onJump={jump} />}
          {panel === 'threads' && <ThreadsPanel story={story} scene={placed.scene} onJump={jump} />}
          {panel === 'comments' && <CommentsPanel story={story} chapter={placed.chapter} onJump={jump} />}
          {panel === 'cuts' && <CutsPanel story={story} />}
          {panel === 'stuck' && <StuckPanel story={story} scene={placed.scene} />}
        </div>
      </aside>
    </div>
  )
}

// ---------- chapters and scenes ----------

function Outline({ story, current }: { story: Story; current: string }) {
  const [renaming, setRenaming] = useState<string | null>(null)
  return (
    <nav className="ws-outline" data-ws-outline>
      {story.chapters.map((c, ci) => (
        <section key={c.id} className="ws-chapter" data-ws-chapter={c.id}>
          <div className="ws-chapter-head">
            {renaming === c.id ? (
              <input
                className="ws-input ws-chapter-rename"
                autoFocus
                onFocus={(e) => e.target.select()}
                placeholder="Chapter name"
                defaultValue={c.title}
                onBlur={(e) => {
                  renameChapter(c.id, e.target.value.trim())
                  setRenaming(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setRenaming(null)
                }}
              />
            ) : (
              <button className="ws-chapter-title" onClick={() => openScene(c.scenes[0].id)} onDoubleClick={() => setRenaming(c.id)} title={`${c.title} (double-click to rename)`}>
                {c.title}
              </button>
            )}
            <span className="ws-count">{chapterWords(c).toLocaleString()}</span>
            <div className="ws-row-actions">
              <button className="icon-btn" onClick={() => setRenaming(c.id)} title="Name this chapter" data-ws-rename-chapter>
                <Pencil size={11} />
              </button>
              <button className="icon-btn" disabled={ci === 0} onClick={() => moveChapter(c.id, -1)} title="Move up">
                <ChevronUp size={12} />
              </button>
              <button className="icon-btn" disabled={ci === story.chapters.length - 1} onClick={() => moveChapter(c.id, 1)} title="Move down">
                <ChevronDown size={12} />
              </button>
              <button className="icon-btn" onClick={() => deleteChapter(c.id)} title="Delete chapter (Ctrl+Z brings it back)">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          <PacingStrip p={chapterPacing(c)} title={c.title} />
          <ul>
            {c.scenes.map((s) => (
              <SceneRow key={s.id} scene={s} on={s.id === current} />
            ))}
          </ul>
          <button className="ws-add-scene" onClick={() => addScene(c.id)} data-ws-add-scene>
            <Plus size={12} /> Scene
          </button>
        </section>
      ))}
      <button className="btn ws-add-chapter" onClick={() => setRenaming(addChapter())} data-ws-add-chapter>
        <Plus size={13} /> Add a chapter
      </button>
      <div className="ws-pacing-key">
        <span>
          <i className="ws-p-dialogue" /> Dialogue
        </span>
        <span>
          <i className="ws-p-action" /> Action
        </span>
        <span>
          <i className="ws-p-description" /> Description
        </span>
      </div>
    </nav>
  )
}

function SceneRow({ scene, on }: { scene: Scene; on: boolean }) {
  return (
    <li className={`ws-scene-row ${on ? 'on' : ''}`}>
      <button onClick={() => openScene(scene.id)} data-ws-scene-row={scene.id}>
        <span className="ws-scene-name">{scene.title}</span>
        <span className="ws-count">{sceneWords(scene).toLocaleString()}</span>
      </button>
      <div className="ws-row-actions">
        <button className="icon-btn" onClick={() => moveScene(scene.id, -1)} title="Move up">
          <ChevronUp size={11} />
        </button>
        <button className="icon-btn" onClick={() => moveScene(scene.id, 1)} title="Move down">
          <ChevronDown size={11} />
        </button>
        <button className="icon-btn" onClick={() => deleteScene(scene.id)} title="Delete scene (Ctrl+Z brings it back)">
          <Trash2 size={11} />
        </button>
      </div>
    </li>
  )
}

// ---------- the scene ----------

function SceneHead({ scene, chapter, compare, setCompare }: { story: Story; scene: Scene; chapter: Chapter; compare: string | null; setCompare: (id: string | null) => void }) {
  const [renamingTake, setRenamingTake] = useState<string | null>(null)
  const others = scene.takes.filter((t) => t.id !== scene.take)
  return (
    <div className="ws-scene-head">
      <div className="ws-scene-title">
        <input
          className="ws-scene-chapter"
          key={`ch${chapter.id}${chapter.title}`}
          defaultValue={chapter.title}
          maxLength={120}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== chapter.title && renameChapter(chapter.id, e.target.value.trim())}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Chapter name"
          title="Click to name this chapter"
          data-ws-chapter-name
        />
        <input
          className="ws-scene-title-input"
          key={scene.id}
          defaultValue={scene.title}
          maxLength={120}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== scene.title && updateScene(scene.id, (s) => void (s.title = e.target.value.trim()))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Scene name"
          data-ws-scene-title
        />
      </div>
      <div className="ws-takes" data-ws-takes>
        {scene.takes.map((t) =>
          renamingTake === t.id ? (
            <input
              key={t.id}
              className="ws-input ws-take-rename"
              autoFocus
              defaultValue={t.name}
              onBlur={(e) => {
                renameTake(scene.id, t.id, e.target.value)
                setRenamingTake(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setRenamingTake(null)
              }}
            />
          ) : (
            <span key={t.id} className={`ws-take ${t.id === scene.take ? 'on' : ''}`}>
              <button
                onClick={() => {
                  if (t.id === compare) setCompare(null)
                  useTake(scene.id, t.id)
                }}
                onDoubleClick={() => setRenamingTake(t.id)}
                title={t.id === scene.take ? 'The take in use: it’s the one that counts and gets exported. Double-click to rename.' : 'Use this take instead. Double-click to rename.'}
                data-ws-take={t.id}
              >
                {t.name}
                <span className="ws-take-words">{countWords(t.text).toLocaleString()}</span>
              </button>
              {scene.takes.length > 1 && (
                <button className="ws-take-x" onClick={() => deleteTake(scene.id, t.id)} title="Delete this take (Ctrl+Z brings it back)">
                  <X size={10} />
                </button>
              )}
            </span>
          )
        )}
        <TakeMenu scene={scene} />
        {others.length > 0 && (
          <button
            className={`btn ws-compare ${compare ? 'on' : ''}`}
            onClick={() => setCompare(compare ? null : others[others.length - 1].id)}
            title="Show another take side by side"
            data-ws-compare
          >
            <Columns2 size={13} /> Side by side
          </button>
        )}
      </div>
    </div>
  )
}

function TakeMenu({ scene }: { scene: Scene }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="ws-take-new">
      <button className="btn" onClick={() => setOpen(!open)} title="Write this scene another way" data-ws-new-take>
        <Plus size={13} /> New take
      </button>
      {open && (
        <div className="ws-menu" onMouseLeave={() => setOpen(false)}>
          <button
            onClick={() => {
              addTake(scene.id, false)
              setOpen(false)
            }}
            data-ws-new-take-blank
          >
            Start blank
          </button>
          <button
            onClick={() => {
              addTake(scene.id, true)
              setOpen(false)
            }}
            data-ws-new-take-copy
          >
            <Copy size={12} /> Start from this take
          </button>
        </div>
      )}
    </span>
  )
}

function SceneDetails({ story, scene }: { story: Story; scene: Scene }) {
  const deferred = useDeferredValue(story)
  const facts = useMemo(() => buildBrain(deferred).scenes.find((s) => s.id === scene.id), [deferred, scene.id])
  const chars = story.entities.filter((e) => e.kind === 'character')
  const places = story.entities.filter((e) => e.kind === 'location')
  const cast = facts?.cast ?? []
  const mentioned = facts?.mentioned ?? []
  const others = chars.filter((c) => !cast.includes(c.id) && !mentioned.includes(c.id))
  const detectedPlace = facts?.place && !scene.place ? entityById(story, facts.place)?.name : null
  const name = (id: string): string => entityById(story, id)?.name ?? ''

  /** In the scene after all (or not): what you say wins over what the text suggests. */
  const setHere = (id: string, here: boolean): void =>
    updateScene(scene.id, (s) => {
      s.castAdd = s.castAdd.filter((x) => x !== id)
      s.castRemove = s.castRemove.filter((x) => x !== id)
      if (here) s.castAdd.push(id)
      else s.castRemove.push(id)
    })

  return (
    <div className="ws-details" data-ws-details>
      <div className="ws-details-row">
        <label className="ws-detail" title="When this happens in the story: a day number like 3 (or Day 3), or a date like 1888-10-31">
          <span className="ws-detail-label">When</span>
          <input
            className="ws-input"
            key={`d${scene.id}`}
            defaultValue={scene.date}
            placeholder="Day 1"
            maxLength={40}
            onBlur={(e) => e.target.value.trim() !== scene.date && updateScene(scene.id, (s) => void (s.date = e.target.value.trim()))}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            data-ws-scene-date
          />
          <input className="ws-input ws-time" type="time" value={scene.time} onChange={(e) => updateScene(scene.id, (s) => void (s.time = e.target.value))} title="Time (optional)" />
        </label>
        <label className="ws-detail">
          <span className="ws-detail-label">Where</span>
          <select className="ws-select" value={scene.place} onChange={(e) => updateScene(scene.id, (s) => void (s.place = e.target.value))} data-ws-scene-place>
            <option value="">{detectedPlace ? `${detectedPlace} (from the text)` : places.length ? 'From the text' : 'Add places in the story brain'}</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ws-details-row">
        <span className="ws-detail-label">In the scene</span>
        <div className="ws-cast" data-ws-cast>
          {cast.map((id) => (
            <span key={id} className={`ws-chip ${scene.castAdd.includes(id) ? 'added' : ''}`} title={scene.castAdd.includes(id) ? 'You added them' : 'Named in this scene'}>
              {name(id)}
              <button onClick={() => setHere(id, false)} title="Not really here (just mentioned)" data-ws-cast-out={id}>
                <X size={10} />
              </button>
            </span>
          ))}
          {!cast.length && chars.length > 0 && <span className="ws-hint">Nobody yet</span>}
          {others.length > 0 && (
            <select
              className="ws-select ws-cast-add"
              value=""
              onChange={(e) => e.target.value && setHere(e.target.value, true)}
              title="Someone in this scene the text doesn't name"
            >
              <option value="">+ Add someone</option>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {!chars.length && (
            <span className="ws-hint">
              <UserPlus size={12} /> Add characters in the story brain and they’re spotted in every scene.
            </span>
          )}
        </div>
      </div>
      {mentioned.length > 0 && (
        <div className="ws-details-row">
          <span className="ws-detail-label" title="Talked or thought about, but not in the scene. They don't count as meeting anyone here.">
            Mentioned
          </span>
          <div className="ws-cast" data-ws-mentioned>
            {mentioned.map((id) => (
              <button key={id} className="ws-chip ws-chip-mention" onClick={() => setHere(id, true)} title="Actually in this scene? Click to move them in" data-ws-cast-in={id}>
                {name(id)} <Plus size={10} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SceneEditor({ story, scene, chapter, focus }: { story: Story; scene: Scene; chapter: Chapter; focus: { from: number; to: number; nonce: number } | null }) {
  const take = activeTake(scene)
  const text = useDeferredValue(take.text)
  const issues = useSceneIssues(story, scene, text)
  const reading = useEditorBridge((s) => s.reading)
  const insert = useEditorBridge((s) => s.insert)
  const follow = useEditorBridge((s) => s.follow)
  const marks = useMemo((): Mark[] => {
    const kinds = new Map(story.entities.map((e) => [e.id, e]))
    const out: Mark[] = findMentions(text, story.entities).map((m) => {
      const e = kinds.get(m.entity)!
      return { from: m.start, to: m.end, kind: 'name', entityKind: e.kind, title: e.name }
    })
    for (const i of issues) out.push({ from: i.start, to: i.end, kind: 'issue', title: i.message })
    for (const t of threadMarks(story, scene.id, text)) out.push(t)
    for (const l of lovedMarks(story, chapter, scene.id)) out.push({ ...l, kind: 'loved' })
    if (reading) out.push({ ...reading, kind: 'reading' })
    return out
    // Names, pages, setups and comments, not every keystroke elsewhere in the story.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, story.entities, story.threads, story.comments, issues, reading, scene.id, chapter])
  return (
    <div className="ws-editor-wrap">
      <StoryEditor
        docKey={take.id}
        text={take.text}
        onChange={(t) => setTakeText(scene.id, take.id, t)}
        marks={marks}
        focusRange={focus}
        hint="Start writing this scene…"
        onSelect={(sel) => useEditorBridge.setState({ sel })}
        insert={insert}
        follow={follow}
      />
    </div>
  )
}

function CompareTake({ scene, takeId, onPick, onClose }: { scene: Scene; takeId: string; onPick: (id: string) => void; onClose: () => void }) {
  const take = scene.takes.find((t) => t.id === takeId)
  if (!take) return null
  const others = scene.takes.filter((t) => t.id !== scene.take)
  return (
    <div className="ws-compare-pane" data-ws-compare-pane>
      <div className="ws-compare-head">
        <select className="ws-select" value={takeId} onChange={(e) => onPick(e.target.value)} disabled={others.length < 2} aria-label="Which take">
          {others.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="ws-count">{countWords(take.text).toLocaleString()} words</span>
        <button
          className="btn btn-primary"
          onClick={() => {
            useTake(scene.id, take.id)
            onClose()
          }}
          title="Make this the take in use"
        >
          Use this one
        </button>
        <button className="icon-btn" onClick={onClose} title="Close">
          <X size={13} />
        </button>
      </div>
      <StoryEditor docKey={`cmp-${take.id}`} text={take.text} marks={[]} readOnly />
    </div>
  )
}

// ---------- checks ----------

type Issue = ReturnType<typeof checkContinuity>[number] & { group: 'page' | 'canon' | 'secret' | 'voice' }

/** Every dialogue line in the story, worked out once per version of the story (it's the slow part of the voice check). */
const linesCache = new WeakMap<Story['chapters'], ReturnType<typeof storyLines>>()
function linesOf(story: Story): ReturnType<typeof storyLines> {
  let hit = linesCache.get(story.chapters)
  if (!hit) {
    hit = storyLines(story)
    linesCache.set(story.chapters, hit)
  }
  return hit
}

/** Everything in a scene's text that goes against the pages, canon, who knows what, or how someone talks. */
function sceneIssues(story: Story, sceneId: string, text: string): Issue[] {
  return [
    ...checkContinuity(story, sceneId, text).map((i) => ({ ...i, group: 'page' as const })),
    ...canonIssues(story, sceneId, text).map((i) => ({ ...i, group: 'canon' as const })),
    ...secretSlips(story, sceneId, text).map((i) => ({ ...i, group: 'secret' as const })),
    ...voiceFlags(story, sceneId, text, linesOf(story)).map((i) => ({ ...i, group: 'voice' as const }))
  ].sort((a, b) => a.start - b.start)
}

function useSceneIssues(story: Story, scene: Scene, text: string): Issue[] {
  const deferred = useDeferredValue(story)
  return useMemo(
    () => sceneIssues(deferred, scene.id, text),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, deferred.entities, deferred.canon, deferred.secrets, deferred.chapters.length, scene.id]
  )
}

function useChecks(story: Story, scene: Scene) {
  const deferred = useDeferredValue(story)
  return useMemo(() => {
    const issues = sceneIssues(deferred, scene.id, sceneText(scene))
    const clashes = calendarClashes(buildBrain(deferred)).filter((c) => c.scenes.includes(scene.id))
    return { issues, clashes }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferred, scene.id])
}

function CheckCount({ story, scene }: { story: Story; scene: Scene }) {
  const { issues, clashes } = useChecks(story, scene)
  const n = issues.length + clashes.length
  return n ? <span className="ws-badge">{n}</span> : null
}

/** The words around a spot, cut at whole words. */
function snippet(text: string, start: number, end: number): string {
  let a = Math.max(0, start - 30)
  let b = Math.min(text.length, end + 30)
  if (a > 0) a = text.indexOf(' ', a) + 1 || a
  if (b < text.length) b = text.lastIndexOf(' ', b) > end ? text.lastIndexOf(' ', b) : b
  return `${a > 0 ? '…' : ''}${text.slice(a, b).trim()}${b < text.length ? '…' : ''}`
}

const GROUPS: { id: Issue['group']; title: string }[] = [
  { id: 'page', title: 'Character pages' },
  { id: 'canon', title: 'Canon' },
  { id: 'secret', title: 'Who knows what' },
  { id: 'voice', title: 'Doesn’t sound like them' }
]

function ChecksPanel({ story, scene, onJump }: { story: Story; scene: Scene; onJump: (scene: string, from: number, to: number) => void }) {
  const { issues, clashes } = useChecks(story, scene)
  const text = sceneText(scene)
  const name = (id: string): string => entityById(story, id)?.name ?? 'Someone'
  const sceneTitle = (id: string): string => allScenes(story).find((p) => p.scene.id === id)?.scene.title ?? 'another scene'
  return (
    <div className="ws-panel" data-ws-checks>
      <h3>Checks</h3>
      {!issues.length && !clashes.length && (
        <p className="ws-panel-empty">Nothing in this scene goes against your character pages, canon, who knows what, the story calendar or how your characters talk.</p>
      )}
      {GROUPS.map((g) => {
        const list = issues.filter((i) => i.group === g.id)
        if (!list.length) return null
        return (
          <div key={g.id} className={`ws-check-group ${g.id}`}>
            <h4>{g.title}</h4>
            {list.map((i, n) => (
              <button key={n} className="ws-issue-row" onClick={() => onJump(scene.id, i.start, i.end)}>
                <q>{snippet(text, i.start, i.end)}</q>
                <span>{i.message}</span>
              </button>
            ))}
          </div>
        )
      })}
      {clashes.length > 0 && (
        <div className="ws-check-group">
          <h4>Story calendar</h4>
          {clashes.map((c, n) => (
            <div key={`c${n}`} className="ws-issue-row clash">
              <span>
                {name(c.character)} is at {name(c.places[0])} and {name(c.places[1])} on {dateLabel(c.date)}.
              </span>
              <button className="link-button" onClick={() => openScene(c.scenes[0] === scene.id ? c.scenes[1] : c.scenes[0])}>
                Go to “{sceneTitle(c.scenes[0] === scene.id ? c.scenes[1] : c.scenes[0])}”
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="ws-panel-tip">
        Checked as you write: facts on character pages and in the canon drawer, someone who has died turning up, secrets slipping out before a character finds out, and lines that don’t sound like the character saying them.
      </p>
    </div>
  )
}

// ---------- the ghost reader ----------

function GhostPanel({ story, chapter, onJump }: { story: Story; chapter: Chapter; onJump: (scene: string, from: number, to: number) => void }) {
  const ai = useWriting((s) => s.ai)
  const [busy, setBusy] = useState<string | null>(null)
  const notes = story.ghost[chapter.id] ?? []
  const run = async (): Promise<void> => {
    setBusy('Reading…')
    try {
      const got = await runGhostReader(story, chapter.id, (done, of) => of > 1 && setBusy(`Reading part ${done + 1} of ${of}…`))
      if (!got.length) notify('The ghost reader didn’t have anything to say this time. Try again, or after writing a bit more.', 'info')
    } catch (err) {
      showAiProblem(err)
    } finally {
      setBusy(null)
    }
  }
  const find = (quote: string): void => {
    for (const s of chapter.scenes) {
      const at = findQuote(sceneText(s), quote)
      if (at) return onJump(s.id, at.start, at.end)
    }
    notify('That bit has changed since the ghost reader read it.', 'info')
  }
  return (
    <div className="ws-panel" data-ws-ghost>
      <h3>Ghost reader</h3>
      <p className="ws-panel-tip">
        Reads “{chapter.title}” as if for the first time and reacts as it goes. {aiWhere(ai)}
      </p>
      <button className="btn btn-primary" onClick={() => void run()} disabled={!!busy} data-ws-ghost-run>
        {busy ? <Loader2 size={13} className="spin" /> : <Ghost size={13} />} {busy ?? (notes.length ? 'Read it again' : 'Read this chapter')}
      </button>
      <ul className="ws-ghost-list">
        {notes.map((g, i) => (
          <li key={g.id} style={{ '--i': i } as CSSProperties}>
            <button onClick={() => find(g.quote)} title="Show this bit">
              <q>{g.quote}</q>
              <span>{g.reaction}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- time-lapse ----------

const SPEEDS = [1, 4, 16, 64]

function TimeLapse({ scene, onClose }: { scene: Scene; onClose: () => void }) {
  const take = activeTake(scene)
  const history = useWriting((s) => s.history[take.id])
  const total = history?.revs.length ?? 0
  const [at, setAt] = useState(total)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(4)
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(() => {
    if (!playing) return
    timer.current = setInterval(() => {
      setAt((n) => {
        if (n >= total) {
          setPlaying(false)
          return total
        }
        return Math.min(total, n + speed)
      })
    }, 60)
    return () => clearInterval(timer.current)
  }, [playing, speed, total])

  const text = history ? textAt(history, at) : take.text
  const when = history && at > 0 ? new Date(history.revs[at - 1].t) : null

  return (
    <div className="ws-timelapse" data-ws-timelapse>
      <div className="ws-timelapse-bar">
        <button
          className="icon-btn"
          onClick={() => {
            if (at >= total) setAt(0)
            setPlaying(!playing)
          }}
          disabled={!total}
          title={playing ? 'Pause' : 'Play'}
          data-ws-timelapse-play
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <input type="range" min={0} max={total} value={at} onChange={(e) => setAt(Number(e.target.value))} disabled={!total} aria-label="Point in the writing" data-ws-timelapse-slider />
        <select className="ws-select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <span className="ws-timelapse-when">
          {!total
            ? 'Nothing recorded yet: the time-lapse starts from your next change.'
            : when
              ? when.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
              : 'The start'}
        </span>
        <button
          className="btn"
          disabled={!total || at === total}
          onClick={() => {
            takeFromVersion(scene.id, `${take.name} (${when ? when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'start'})`, text)
            onClose()
          }}
          title="Bring back this version as a new take (nothing is lost)"
          data-ws-timelapse-restore
        >
          <Undo2 size={13} /> Bring this version back
        </button>
        <button className="icon-btn" onClick={onClose} title="Close the time-lapse">
          <X size={14} />
        </button>
      </div>
      <div className="ws-editor-wrap">
        <StoryEditor docKey={`tl-${take.id}`} text={text} marks={[]} readOnly />
      </div>
    </div>
  )
}
