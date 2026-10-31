import { Clapperboard, Square } from 'lucide-react'
import { formatDuration } from '@shared/studio'
import { switchScene, useStudio } from '../../store/studio'
import { openSpecialTab, STUDIO_TAB } from '../../lib/editorController'
import { useNow } from './StudioPage'

/** While recording, a small bar floats in the corner of every page: the time, the scenes, and Stop. */
export default function RecordingBar() {
  const recording = useStudio((s) => s.recording)
  const live = useStudio((s) => s.live)
  const scenes = useStudio((s) => s.scenes)
  const active = useStudio((s) => s.activeScene)
  const now = useNow(!!recording || !!live)
  if (!recording && !live) return null
  return (
    <div className="studio-float" role="status" data-studio-float>
      {live && <span className="studio-float-live">LIVE {formatDuration(now - live.startedAt)}</span>}
      {recording && (
        <>
          <span className="studio-dot" />
          <span className="studio-float-time">{formatDuration(now - recording.startedAt)}</span>
        </>
      )}
      <select value={active} onChange={(e) => switchScene(e.target.value)} title="Scene">
        {scenes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button className="icon-btn" title="Open the Studio" onClick={() => openSpecialTab(STUDIO_TAB)}>
        <Clapperboard size={14} />
      </button>
      {recording && (
      <button className="icon-btn studio-float-stop" title="Stop recording" onClick={() => void import('../../lib/studio').then((m) => m.stopRecording())}>
        <Square size={12} fill="currentColor" />
      </button>
      )}
    </div>
  )
}
