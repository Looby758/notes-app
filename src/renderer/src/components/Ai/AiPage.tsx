import './ai.css'
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2, RotateCcw } from 'lucide-react'
import { askNotes, askOnline, clearAsk, refreshAiStatus, setAskSource, useAi, usesOffline, type AskSources } from '../../store/ai'
import { useNoteIndex } from '../../store/noteIndex'
import { notify } from '../../store/notify'
import { openNote, openSpecialTab, SETTINGS_TAB } from '../../lib/editorController'
import { answerParts } from '../../lib/ai'
import { openAiSettings } from './AiSettings'
import EmptyArt from '../Motion/EmptyArt'
import OnlineOffer from './OnlineOffer'

const EXAMPLES = ['What’s on this week?', 'How much did I spend on takeaways last month?', 'Any emails I need to reply to?', 'What’s still on my to-do lists?']

const SOURCE_LABELS: { key: keyof AskSources; label: string }[] = [
  { key: 'email', label: 'Email' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'money', label: 'Money' }
]

/** Which of your things Ask everything may look at (notes always). */
function Sources() {
  const sources = useAi((s) => s.sources)
  return (
    <div className="ai-sources" data-ask-sources>
      <span>Looks at your notes{SOURCE_LABELS.some((x) => sources[x.key]) ? ' and' : ''}:</span>
      {SOURCE_LABELS.map(({ key, label }) => (
        <label key={key} className={`ai-source ${sources[key] ? 'on' : ''}`}>
          <input type="checkbox" checked={sources[key]} onChange={(e) => setAskSource(key, e.target.checked)} />
          {label}
        </label>
      ))}
    </div>
  )
}

/** An answer with its [[links]] turned into buttons that open the note. */
function Answer({ text }: { text: string }) {
  const open = (title: string): void => {
    const path = useNoteIndex.getState().lookup.resolve({ kind: 'wiki', target: title }, '')
    if (path) openNote(path)
    else notify(`Note not found: ${title}`)
  }
  return (
    <div className="ai-answer" data-ai-answer>
      {answerParts(text).map((p, i) =>
        'link' in p ? (
          <button key={i} className="ai-link" onClick={() => open(p.link)}>
            {p.label}
          </button>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </div>
  )
}

/** "Ask everything": questions answered by Claude from your notes, and your email, calendar and money if you allow it. */
export default function AiPage({ autoFocus }: { autoFocus: boolean }) {
  const status = useAi((s) => s.status)
  const turns = useAi((s) => s.turns)
  const [question, setQuestion] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const waiting = turns.some((t) => !t.answer && !t.error)

  useEffect(() => {
    refreshAiStatus()
  }, [])
  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus, status?.ready])
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [turns])

  const send = (q = question): void => {
    if (!q.trim() || waiting) return
    setQuestion('')
    askNotes(q)
  }

  const offline = usesOffline(status)
  if (status && !status.ready) {
    return (
      <div className="ai-page" data-ai-page>
        <div className="ai-empty">
          <EmptyArt kind="sparkle" size={64} />
          <h2>Ask everything</h2>
          <p>Ask a question in your own words and Claude answers from your notes, email, calendar and money, with links to the notes it used.</p>
          <p>To start, download the offline AI (it runs on this computer) or add your Anthropic API key, both in Settings.</p>
          <button
            className="btn btn-primary"
            onClick={() => {
              openSpecialTab(SETTINGS_TAB)
              openAiSettings()
            }}
          >
            Set up the AI helper
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ai-page" data-ai-page>
      <div className="ai-turns">
        {turns.length === 0 && (
          <div className="ai-empty">
            <EmptyArt kind="sparkle" size={64} />
            <h2>Ask everything</h2>
            <p>
              Ask anything about your notes, emails, calendar or money. Orbit picks out what matches your question and{' '}
              {offline ? 'the offline AI answers from it, right here on this computer.' : 'Claude answers from it. Nothing is sent until you ask.'}
            </p>
            <Sources />
            <div className="ai-examples">
              {EXAMPLES.map((e) => (
                <button key={e} className="btn" onClick={() => send(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="ai-turn">
            <div className="ai-question">{t.question}</div>
            {t.answer && <Answer text={t.answer} />}
            {t.answer && t.offline && <OnlineOffer hard={t.hard} privately={t.private} busy={waiting} onAsk={() => void askOnline(t)} />}
            {t.error && <p className="setting-warning">{t.error}</p>}
            {!t.answer && !t.error && (
              <p className="ai-working">
                <Loader2 size={14} className="spin" /> Looking through your things…
              </p>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="ai-input">
        {turns.length > 0 && (
          <button className="icon-btn" title="Start over" onClick={clearAsk} disabled={waiting}>
            <RotateCcw size={14} />
          </button>
        )}
        <textarea
          ref={input}
          rows={1}
          value={question}
          placeholder="Ask about your notes, email, calendar or money…"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          data-ai-question
        />
        <button className="btn btn-primary" onClick={() => send()} disabled={!question.trim() || waiting} title="Ask">
          <ArrowUp size={14} />
        </button>
      </div>
    </div>
  )
}
