import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Brain, CalendarDays, Feather, Maximize2, Minimize2, PenLine, Plus, Share, Target, Trash2, X } from 'lucide-react'
import { storyWords, wordsToday, writingStreak, type StoryListing } from '@shared/writing'
import { useVault } from '../../store/vault'
import { closeStory, createStory, loadLibrary, openStory, removeStory, setStoryField, useWriting, type StudioView } from '../../store/writingStudio'
import WriteView from './WriteView'
import BrainView from './BrainView'
import CalendarView from './CalendarView'
import ExportView from './ExportView'
import './writingStudio.css'

/**
 * The Writing Studio: a full-screen place for stories, separate from notes. The library of
 * stories first; open one to write it, look things up in its brain, see its story calendar, or
 * export it.
 */
export default function WritingStudioPage() {
  const vault = useVault((s) => s.vault)
  const story = useWriting((s) => s.story)
  const full = useWriting((s) => s.full)

  useEffect(() => {
    void loadLibrary(vault)
  }, [vault])

  // Leaving full screen with Esc (or F11) turns the studio's full-screen look off too.
  useEffect(() => {
    const on = (): void => {
      if (!document.fullscreenElement && useWriting.getState().full) useWriting.setState({ full: false })
    }
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  return (
    <div className={`ws ${full ? 'ws-full' : ''}`} data-writing-studio>
      {story ? <StoryScreen /> : <Library />}
    </div>
  )
}

export function toggleFull(): void {
  const full = !useWriting.getState().full
  useWriting.setState({ full })
  if (full) void document.documentElement.requestFullscreen?.().catch(() => {})
  else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
}

// ---------- the library ----------

function ago(t: number): string {
  if (!t) return ''
  const mins = Math.round((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function Library() {
  const library = useWriting((s) => s.library)
  const loaded = useWriting((s) => s.loaded)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')

  const make = (): void => {
    createStory(title)
    setTitle('')
    setAdding(false)
  }

  return (
    <div className="ws-library" data-ws-library>
      <div className="ws-library-inner">
        <header className="ws-library-head">
          <div>
            <h1>
              <Feather size={22} /> Writing Studio
            </h1>
            <p>Your stories, kept separate from your notes.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setAdding(true)} data-ws-new-story>
            <Plus size={14} /> New story
          </button>
        </header>

        {adding && (
          <div className="ws-new-story">
            <input
              className="text-input"
              autoFocus
              value={title}
              maxLength={120}
              placeholder="What’s it called? (You can change it later)"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') make()
                if (e.key === 'Escape') setAdding(false)
              }}
              data-ws-new-title
            />
            <button className="btn btn-primary" onClick={make} data-ws-create>
              Start writing
            </button>
            <button className="icon-btn" onClick={() => setAdding(false)} title="Cancel">
              <X size={14} />
            </button>
          </div>
        )}

        {loaded && !library.length && !adding && (
          <div className="ws-empty">
            <BookOpen size={36} />
            <h2>No stories yet</h2>
            <p>Start one and it gets its own chapters, scenes, characters and story brain. Nothing here ever shows up in your notes.</p>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={14} /> Start a story
            </button>
          </div>
        )}

        <div className="ws-shelf">
          {library.map((l) => (
            <StoryCard key={l.id} l={l} />
          ))}
        </div>
      </div>
    </div>
  )
}

function StoryCard({ l }: { l: StoryListing }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <article className="ws-card" data-ws-story-card={l.id}>
      <button className="ws-card-open" onClick={() => void openStory(l.id)}>
        <span className="ws-card-spine" aria-hidden />
        <h3>{l.title}</h3>
        <p>
          {l.words.toLocaleString()} words · {l.chapters} chapter{l.chapters === 1 ? '' : 's'}
        </p>
        <p className="ws-card-when">Edited {ago(l.updated)}</p>
      </button>
      <div className="ws-card-actions">
        {confirm ? (
          <>
            <button className="link-button danger" onClick={() => removeStory(l.id)}>
              Remove
            </button>
            <button className="icon-btn" onClick={() => setConfirm(false)} title="Keep it">
              <X size={13} />
            </button>
          </>
        ) : (
          <button className="icon-btn" onClick={() => setConfirm(true)} title="Remove from the library">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </article>
  )
}

// ---------- an open story ----------

const VIEWS: { id: StudioView; label: string; icon: typeof PenLine }[] = [
  { id: 'write', label: 'Write', icon: PenLine },
  { id: 'brain', label: 'Story brain', icon: Brain },
  { id: 'calendar', label: 'Story calendar', icon: CalendarDays },
  { id: 'export', label: 'Export', icon: Share }
]

function StoryScreen() {
  const story = useWriting((s) => s.story)!
  const view = useWriting((s) => s.view)
  const full = useWriting((s) => s.full)
  const closing = useWriting((s) => s.closing)
  const [editingTitle, setEditingTitle] = useState(false)
  const [goals, setGoals] = useState(false)

  return (
    <div className="ws-story" data-ws-story>
      <header className="ws-bar">
        <button className="icon-btn" onClick={() => useWriting.setState({ closing: true })} title="Back to your stories" data-ws-back>
          <ArrowLeft size={16} />
        </button>
        {editingTitle ? (
          <input
            className="text-input ws-title-input"
            autoFocus
            defaultValue={story.title}
            maxLength={120}
            onBlur={(e) => {
              if (e.target.value.trim()) setStoryField({ title: e.target.value.trim() })
              setEditingTitle(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditingTitle(false)
            }}
          />
        ) : (
          <button className="ws-title" onClick={() => setEditingTitle(true)} title="Rename the story">
            {story.title}
          </button>
        )}
        <nav className="ws-views" role="tablist">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} className={`ws-view ${view === v.id ? 'on' : ''}`} onClick={() => useWriting.setState({ view: v.id })} data-ws-view={v.id}>
              <v.icon size={14} /> {v.label}
            </button>
          ))}
        </nav>
        <div className="ws-bar-right">
          <GoalMeter onClick={() => setGoals((g) => !g)} />
          <button className="icon-btn" onClick={toggleFull} title={full ? 'Leave full screen (Esc)' : 'Full screen'} data-ws-full>
            {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
        {goals && <GoalsPopover onClose={() => setGoals(false)} />}
      </header>
      <div className="ws-body">
        {view === 'write' && <WriteView />}
        {view === 'brain' && <BrainView />}
        {view === 'calendar' && <CalendarView />}
        {view === 'export' && <ExportView />}
      </div>
      {closing && <LeftOffPrompt />}
    </div>
  )
}

function GoalMeter({ onClick }: { onClick: () => void }) {
  const story = useWriting((s) => s.story)!
  const now = new Date()
  const today = wordsToday(story, now)
  const total = storyWords(story)
  const daily = story.dailyGoal
  const pct = daily ? Math.min(1, today / daily) : 0
  return (
    <button className={`ws-goal ${daily && today >= daily ? 'done' : ''}`} onClick={onClick} title="Word goals" data-ws-goal>
      {daily > 0 && (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle cx="9" cy="9" r="7" className="ws-goal-track" />
          <circle cx="9" cy="9" r="7" className="ws-goal-fill" strokeDasharray={`${pct * 44} 44`} transform="rotate(-90 9 9)" />
        </svg>
      )}
      {daily === 0 && <Target size={14} />}
      <span>
        <b>{today.toLocaleString()}</b>
        {daily ? ` / ${daily.toLocaleString()}` : ''} today
      </span>
      <span className="ws-goal-total">· {total.toLocaleString()} total</span>
    </button>
  )
}

function GoalsPopover({ onClose }: { onClose: () => void }) {
  const story = useWriting((s) => s.story)!
  const total = storyWords(story)
  const streak = writingStreak(story, new Date())
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-ws-goal]')) onClose()
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [onClose])
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (13 - i))
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { key, words: story.days[key] ?? 0, label: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) }
  })
  const most = Math.max(1, story.dailyGoal, ...last14.map((d) => d.words))
  return (
    <div className="ws-popover ws-goals" ref={ref} data-ws-goals>
      <label>
        <span>Words a day</span>
        <input className="text-input" type="number" min={0} step={50} defaultValue={story.dailyGoal || ''} placeholder="e.g. 500" onChange={(e) => setStoryField({ dailyGoal: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} data-ws-daily-goal />
      </label>
      <label>
        <span>Words for the whole story</span>
        <input className="text-input" type="number" min={0} step={1000} defaultValue={story.goal || ''} placeholder="e.g. 80000" onChange={(e) => setStoryField({ goal: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} data-ws-story-goal />
      </label>
      {story.goal > 0 && (
        <div className="ws-goal-bar" title={`${Math.round((total / story.goal) * 100)}%`}>
          <div style={{ width: `${Math.min(100, (total / story.goal) * 100)}%` }} />
          <span>
            {total.toLocaleString()} of {story.goal.toLocaleString()} ({Math.round((total / story.goal) * 100)}%)
          </span>
        </div>
      )}
      <div className="ws-days" aria-label="Words each day, the last two weeks">
        {last14.map((d) => (
          <div key={d.key} className={`ws-day ${story.dailyGoal && d.words >= story.dailyGoal ? 'hit' : ''}`} title={`${d.label}: ${d.words.toLocaleString()} words`}>
            <div style={{ height: `${Math.max(2, (d.words / most) * 100)}%` }} />
          </div>
        ))}
      </div>
      <p className="ws-streak">{streak > 0 ? `🔥 ${streak} day${streak === 1 ? '' : 's'} in a row` : 'Write today to start a streak.'}</p>
    </div>
  )
}

/** Before closing a story: one line for next time. */
function LeftOffPrompt() {
  const story = useWriting((s) => s.story)!
  const [text, setText] = useState('')
  return (
    <div className="ws-modal-back" onMouseDown={(e) => e.target === e.currentTarget && useWriting.setState({ closing: false })}>
      <div className="ws-modal" role="dialog" aria-label="Where you left off" data-ws-leftoff>
        <h2>Where did you leave off?</h2>
        <p>One line for next time, like “Mara is about to open the door.” It’s the first thing you’ll see when you come back.</p>
        <input
          className="text-input"
          autoFocus
          value={text}
          maxLength={500}
          placeholder={story.leftOff?.text ?? 'Mara is about to open the door…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') closeStory(text)
            if (e.key === 'Escape') useWriting.setState({ closing: false })
          }}
          data-ws-leftoff-input
        />
        <div className="ws-modal-buttons">
          <button className="btn" onClick={() => closeStory(null)} data-ws-leftoff-skip>
            Skip
          </button>
          <button className="btn btn-primary" onClick={() => closeStory(text)} data-ws-leftoff-save>
            Save and close
          </button>
        </div>
      </div>
    </div>
  )
}
