import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Mic, Square, Zap } from 'lucide-react'
import { formatDuration, saveRecording, startRecording, type Recording } from '../lib/voice'
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

  // A voice note: the mic button records; stopping saves it and adds it to the capture.
  const [rec, setRec] = useState<Recording | null>(null)
  const [voice, setVoice] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const folder = usePrefs((s) => s.prefs.attachmentFolder)
  useEffect(() => {
    if (!rec) return
    const t = setInterval(() => setElapsed(Date.now() - rec.startedAt), 250)
    return () => clearInterval(t)
  }, [rec])
  useEffect(() => window.api.onCaptureReset(() => setVoice(null)), [])
  const toggleRecording = async (): Promise<void> => {
    setError(null)
    if (rec) {
      const blob = await rec.stop()
      setRec(null)
      window.api.captureKeepOpen(false)
      try {
        setVoice(await saveRecording(blob, folder))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
      input.current?.focus()
      return
    }
    try {
      window.api.captureKeepOpen(true)
      setElapsed(0)
      setRec(await startRecording())
    } catch (err) {
      window.api.captureKeepOpen(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const save = async (): Promise<void> => {
    if ((!text.trim() && !voice) || saving || rec) return
    setSaving(true)
    setError(null)
    const withVoice = voice ? `${text.trim() || 'Voice note'}\n![Voice note](vault:${voice})` : text
    const result = await window.api.submitCapture(withVoice)
    setSaving(false)
    if (!result.ok) setError(result.error ?? 'Couldn’t save that.')
    else setVoice(null)
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
        {voice && !rec && <span className="capture-voice">🎙 Voice note added</span>}
        <button
          className={`icon-btn capture-mic ${rec ? 'recording' : ''}`}
          onClick={toggleRecording}
          title={rec ? 'Stop recording' : 'Record a voice note'}
          data-capture-mic
        >
          {rec ? <Square size={13} /> : <Mic size={15} />}
          {rec && <span>{formatDuration(elapsed)}</span>}
        </button>
        <button className="btn btn-primary" onClick={save} disabled={(!text.trim() && !voice) || saving || !!rec}>
          <CornerDownLeft size={13} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {status?.error && <div className="capture-warning">{status.error}</div>}
    </div>
  )
}
