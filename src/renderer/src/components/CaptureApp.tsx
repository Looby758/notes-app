import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Zap } from 'lucide-react'
import type { CaptureStatus } from '@shared/types'
import { usePrefs } from '../store/prefs'

/** The small quick-capture window (Win+Shift+N). Enter saves, Shift+Enter adds a line, Esc closes. */
export default function CaptureApp() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<CaptureStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const target = usePrefs((s) => s.prefs.captureTarget)
  const heading = usePrefs((s) => s.prefs.captureHeading)
  const inbox = usePrefs((s) => s.prefs.captureInbox)

  // Each time the window is shown: start fresh and focus.
  useEffect(() => {
    const reset = (): void => {
      setText('')
      setError(null)
      setSaving(false)
      window.api.captureStatus().then(setStatus)
      setTimeout(() => input.current?.focus(), 0)
    }
    reset()
    return window.api.onCaptureReset(reset)
  }, [])

  const save = async (): Promise<void> => {
    if (!text.trim() || saving) return
    setSaving(true)
    setError(null)
    const result = await window.api.submitCapture(text)
    setSaving(false)
    if (!result.ok) setError(result.error ?? 'Couldn’t save that.')
    // On success the window hides itself; the next open resets it.
  }

  const where = target === 'daily' ? `Today’s note${heading ? ` › ${heading}` : ''}` : inbox

  return (
    <div className="capture">
      <div className="capture-head">
        <Zap size={14} />
        <span>Quick capture</span>
        <span className="capture-where">→ {where}</span>
      </div>
      <textarea
        ref={input}
        className="capture-input"
        value={text}
        placeholder="What’s on your mind?"
        spellCheck
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            window.api.closeCapture()
          }
        }}
      />
      <div className="capture-foot">
        {error ? (
          <span className="capture-error">{error}</span>
        ) : (
          <span>
            <kbd>Enter</kbd> save · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line · <kbd>Esc</kbd> close
          </span>
        )}
        <button className="btn btn-primary" onClick={save} disabled={!text.trim() || saving}>
          <CornerDownLeft size={13} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {status?.error && <div className="capture-warning">{status.error}</div>}
    </div>
  )
}
