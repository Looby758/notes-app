import { EyeOff } from 'lucide-react'
import { noteTitle } from '../../lib/paths'
import { showNote } from '../../store/streamer'
import Private from './Private'
import { usePrefs } from '../../store/prefs'
import './streamer.css'

/** Shown in a pane instead of a note in streamer mode, until you click Show. */
export default function NoteCover({ path, autoFocus }: { path: string; autoFocus: boolean }) {
  const hideNames = usePrefs((s) => s.prefs.streamerHideNames)
  return (
    <div className="lock-screen streamer-cover" data-streamer-cover={path}>
      <EyeOff size={34} strokeWidth={1.4} />
      <h2>
        <Private when={hideNames}>{noteTitle(path)}</Private>
      </h2>
      <p>Streamer mode is on, so notes stay hidden until you choose to show them.</p>
      <button className="btn btn-primary" autoFocus={autoFocus} onClick={() => showNote(path)}>
        Show note
      </button>
    </div>
  )
}
