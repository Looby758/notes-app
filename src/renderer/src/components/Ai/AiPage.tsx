import './ai.css'
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2, RotateCcw, Sparkles } from 'lucide-react'
import { askNotes, clearAsk, refreshAiStatus, useAi } from '../../store/ai'
import { useNoteIndex } from '../../store/noteIndex'
import { notify } from '../../store/notify'
import { openNote, openSpecialTab, SETTINGS_TAB } from '../../lib/editorController'
import { answerParts } from '../../lib/ai'
import { openAiSettings } from './AiSettings'

const EXAMPLES = ['What did I decide about the trip?', 'What’s still on my to-do lists?', 'When is the dentist appointment?']

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

/** "Ask my notes": questions answered by Claude from the notes that best match them. */
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
  }, [autoFocus, status?.hasKey])
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [turns])

  const send = (q = question): void => {
    if (!q.trim() || waiting) return
    setQuestion('')
    askNotes(q)
  }

  if (status && !status.hasKey) {
    return (
      <div className="ai-page" data-ai-page>
        <div className="ai-empty">
          <Sparkles size={30} strokeWidth={1.4} />
          <h2>Ask my notes</h2>
          <p>Ask a question in your own words and Claude answers from your notes, with links to the notes it used.</p>
          <p>To start, add your Anthropic API key in Settings.</p>
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
            <Sparkles size={30} strokeWidth={1.4} />
            <h2>Ask my notes</h2>
            <p>Ask anything about what you’ve written. Claude reads the notes that best match your question and answers from them.</p>
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
            {t.error && <p className="setting-warning">{t.error}</p>}
            {!t.answer && !t.error && (
              <p className="ai-working">
                <Loader2 size={14} className="spin" /> Looking through your notes…
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
          placeholder="Ask a question about your notes…"
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
