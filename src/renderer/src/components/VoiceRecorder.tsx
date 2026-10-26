import { useEffect, useRef, useState } from 'react'
import { Mic, Square, X } from 'lucide-react'
import { useUI } from '../store/ui'
import { usePrefs } from '../store/prefs'
import { useVault } from '../store/vault'
import { notify } from '../store/notify'
import { insertIntoActiveNote } from '../lib/editorController'
import { formatDuration, saveRecording, startRecording, type Recording } from '../lib/voice'

/**
 * Recording a voice note: starts straight away; Stop saves it into the attachments folder and
 * puts a player in the note at the cursor. Esc cancels.
 */
export default function VoiceRecorder() {
  const open = useUI((s) => s.voiceOpen)
  return open ? <Recorder close={() => useUI.setState({ voiceOpen: false })} /> : null
}

function Recorder({ close }: { close: () => void }) {
  const [rec, setRec] = useState<Recording | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [saving, setSaving] = useState(false)
  const recRef = useRef<Recording | null>(null)
  const folder = usePrefs((s) => s.prefs.attachmentFolder)

  useEffect(() => {
    let cancelled = false
    startRecording()
      .then((r) => {
        if (cancelled) return r.cancel()
        recRef.current = r
        setRec(r)
      })
      .catch((err) => {
        notify(err)
        close()
      })
    return () => {
      cancelled = true
      recRef.current?.cancel()
    }
  }, [close])

  useEffect(() => {
    if (!rec) return
    let raf = 0
    const tick = (): void => {
      setElapsed(Date.now() - rec.startedAt)
      setLevel(rec.level())
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [rec])

  const stop = async (): Promise<void> => {
    if (!rec || saving) return
    setSaving(true)
    try {
      const blob = await rec.stop()
      recRef.current = null
      const path = await saveRecording(blob, folder)
      insertIntoActiveNote(path)
      useVault.getState().refresh()
    } catch (err) {
      notify(err)
    }
    close()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        void stop()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const bars = 18
  return (
    <div className="voice-recorder" role="dialog" aria-label="Recording a voice note" data-voice-recorder>
      <span className={`voice-dot ${rec ? 'live' : ''}`}>
        <Mic size={16} />
      </span>
      <div className="voice-body">
        <div className="voice-title">{rec ? (saving ? 'Saving…' : 'Recording') : 'Starting the microphone…'}</div>
        <div className="voice-meter" aria-hidden>
          {Array.from({ length: bars }, (_, i) => (
            <i key={i} style={{ opacity: i / bars < level ? 1 : 0.2 }} />
          ))}
        </div>
      </div>
      <span className="voice-time" data-voice-time>
        {formatDuration(elapsed)}
      </span>
      <button className="btn btn-primary voice-stop" onClick={stop} disabled={!rec || saving} title="Stop and save (Enter)" data-voice-stop>
        <Square size={12} /> Stop
      </button>
      <button className="icon-btn" onClick={close} title="Cancel (Esc)">
        <X size={14} />
      </button>
    </div>
  )
}
